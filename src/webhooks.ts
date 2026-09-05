import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

import {
  BasstokApiError,
  BasstokClient,
  type Chat,
  type Content,
  type Member,
} from "./basstok.js";
import {
  CredentialAuthorizationRequiredError,
  defaultCredentialsFile,
  RotatingCredentials,
} from "./credentials.js";
import {
  environmentPort,
  optionalEnvironment,
  requiredEnvironment,
} from "./environment.js";

interface WebhookEnvelope {
  id: string;
  occurred_at: string;
  organization_id: string;
}

export type WebhookPayload = WebhookEnvelope & (
  | {
      event: "content.changed";
      resource: { type: "Content"; id: string };
      actor_id?: never;
    }
  | {
      event: "member.created";
      resource: { type: "Member"; id: string };
      actor_id?: never;
    }
  | {
      event: "chat.changed";
      resource: { type: "Chat"; id: string };
      actor_id?: string;
    }
);

export interface WebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export interface AgentWebhookServerOptions {
  secret: string;
  onEvent: (event: WebhookPayload) => Promise<void>;
  onError?: (error: unknown) => void;
  maximumBodyBytes?: number;
  maximumActiveDeliveries?: number;
  maximumConnections?: number;
  requestTimeoutMs?: number;
  settledDeliveryLimit?: number;
}

export interface AgentWebhookHandlers {
  name: string;
  onContentChanged?: (content: Content, api: BasstokClient) => Promise<void>;
  onMemberCreated?: (member: Member, api: BasstokClient) => Promise<void>;
  onChatChanged?: (
    chat: Chat,
    actorId: string | undefined,
    api: BasstokClient,
  ) => Promise<void>;
}

export function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  rawBody: Uint8Array,
): boolean {
  if (!/^v1=[0-9a-f]{64}$/.test(headers.signature)) return false;
  const expected = createHmac("sha256", secret)
    .update(`v1\n${headers.id}\n${headers.timestamp}\n`)
    .update(rawBody)
    .digest("hex");
  const supplied = Buffer.from(headers.signature.slice(3), "hex");
  const calculated = Buffer.from(expected, "hex");
  return supplied.length === calculated.length && timingSafeEqual(supplied, calculated);
}

export function parseWebhook(rawBody: Uint8Array): WebhookPayload {
  if (rawBody.byteLength > 64 * 1024) {
    throw new Error("Basstok webhook payload is too large");
  }
  const value = JSON.parse(Buffer.from(rawBody).toString("utf8")) as {
    id?: unknown;
    event?: unknown;
    occurred_at?: unknown;
    organization_id?: unknown;
    resource?: { type?: unknown; id?: unknown };
    actor_id?: unknown;
  };
  if (
    !boundedWebhookString(value.id, 256) ||
    !boundedWebhookString(value.occurred_at, 64) ||
    !boundedWebhookString(value.organization_id, 256) ||
    value.resource === undefined ||
    !boundedWebhookString(value.resource.id, 256) ||
    (value.actor_id !== undefined && !boundedWebhookString(value.actor_id, 128))
  ) {
    throw new Error("Invalid Basstok webhook payload");
  }
  const matchingResource =
    (value.event === "content.changed" && value.resource.type === "Content") ||
    (value.event === "member.created" && value.resource.type === "Member") ||
    (value.event === "chat.changed" && value.resource.type === "Chat");
  if (!matchingResource ||
      (value.event !== "chat.changed" && value.actor_id !== undefined)) {
    throw new Error("Invalid Basstok webhook payload");
  }
  return value as WebhookPayload;
}

export function createAgentWebhookServer(
  options: AgentWebhookServerOptions,
): Server {
  const maximumBodyBytes = positiveBound(
    "maximumBodyBytes",
    options.maximumBodyBytes ?? 64 * 1024,
  );
  const maximumActiveDeliveries = positiveBound(
    "maximumActiveDeliveries",
    options.maximumActiveDeliveries ?? 2,
  );
  const settledDeliveryLimit = positiveBound(
    "settledDeliveryLimit",
    options.settledDeliveryLimit ?? 1_000,
  );
  const maximumConnections = positiveBound(
    "maximumConnections",
    options.maximumConnections ?? 16,
  );
  const requestTimeoutMs = positiveBound(
    "requestTimeoutMs",
    options.requestTimeoutMs ?? 15_000,
  );
  const settled = new Set<string>();
  const settledOrder: string[] = [];
  const active = new Map<string, Promise<void>>();
  const resourceTails = new Map<string, Promise<void>>();

  const server = createServer({
    requestTimeout: requestTimeoutMs,
    headersTimeout: Math.min(requestTimeoutMs, 5_000),
    keepAliveTimeout: Math.min(requestTimeoutMs, 5_000),
    connectionsCheckingInterval: Math.min(requestTimeoutMs, 1_000),
  }, async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
        .end("ok\n");
      return;
    }
    if (request.method !== "POST" || request.url !== "/webhooks/basstok") {
      response.writeHead(404).end();
      return;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readBody(request, maximumBodyBytes, requestTimeoutMs);
    } catch (error) {
      response.writeHead(
        error instanceof BodyTooLargeError ? 413
          : error instanceof BodyTimedOutError ? 408
          : 400,
      ).end();
      return;
    }

    let headers: WebhookHeaders;
    let event: WebhookPayload;
    try {
      headers = {
        id: oneHeader(request, "basstok-webhook-id"),
        timestamp: oneHeader(request, "basstok-webhook-timestamp"),
        signature: oneHeader(request, "basstok-webhook-signature"),
      };
      if (!verifyWebhook(options.secret, headers, rawBody)) {
        response.writeHead(401).end();
        return;
      }
      event = parseWebhook(rawBody);
      if (event.id !== headers.id || event.occurred_at !== headers.timestamp) {
        response.writeHead(400).end();
        return;
      }
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (settled.has(event.id)) {
      response.writeHead(204).end();
      return;
    }

    let work = active.get(event.id);
    const ownsWork = work === undefined;
    if (work === undefined) {
      if (active.size >= maximumActiveDeliveries) {
        response.writeHead(503, { "Retry-After": "1" }).end();
        return;
      }
      const resourceKey = `${event.organization_id}\n${event.resource.type}\n${event.resource.id}`;
      const previous = resourceTails.get(resourceKey);
      work = (previous === undefined ? Promise.resolve() : previous.catch(() => undefined))
        .then(() => options.onEvent(event));
      active.set(event.id, work);
      resourceTails.set(resourceKey, work);
      const clearResourceTail = (): void => {
        if (resourceTails.get(resourceKey) === work) resourceTails.delete(resourceKey);
      };
      void work.then(clearResourceTail, clearResourceTail);
    }

    try {
      await work;
    } catch (error) {
      options.onError?.(error);
      response.writeHead(500).end();
      return;
    } finally {
      if (ownsWork && active.get(event.id) === work) active.delete(event.id);
    }

    if (!settled.has(event.id)) {
      settled.add(event.id);
      settledOrder.push(event.id);
      if (settledOrder.length > settledDeliveryLimit) {
        const oldest = settledOrder.shift();
        if (oldest !== undefined) settled.delete(oldest);
      }
    }
    response.writeHead(204).end();
  });
  server.maxConnections = maximumConnections;
  server.maxRequestsPerSocket = 100;
  return server;
}

export async function serveAgentWebhooks(
  handlers: AgentWebhookHandlers,
): Promise<Server> {
  const basstokUrl = requiredEnvironment("BASSTOK_URL");
  const credentials = await RotatingCredentials.open(
    optionalEnvironment("BASSTOK_CREDENTIALS_FILE") ?? defaultCredentialsFile,
    {
      basstokUrl,
      clientId: requiredEnvironment("BASSTOK_CLIENT_ID"),
    },
  );
  try {
    const api = new BasstokClient(basstokUrl, credentials);
    let server: Server;
    server = createAgentWebhookServer({
      secret: credentials.webhookSecret,
      onEvent: (event) => dispatchAgentWebhook(event, handlers, api),
      onError: (error) => {
        console.error(error);
        if (error instanceof CredentialAuthorizationRequiredError) server.close();
      },
    });
    server.once("close", () => {
      void credentials.close().catch(console.error);
    });
    const port = environmentPort("PORT", 3000);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port);
    });
    console.log(`${handlers.name} listening on ${port}`);
    return server;
  } catch (error) {
    await credentials.close();
    throw error;
  }
}

export async function dispatchAgentWebhook(
  event: WebhookPayload,
  handlers: AgentWebhookHandlers,
  api: BasstokClient,
): Promise<void> {
  if (event.event === "content.changed" && handlers.onContentChanged !== undefined) {
    const content = await authorizedDereference(() => api.getContent(event.resource.id));
    if (content !== undefined) {
      await settleNonRetryableAction(() => handlers.onContentChanged!(content, api));
    }
  } else if (event.event === "member.created" && handlers.onMemberCreated !== undefined) {
    const member = await authorizedDereference(() => api.getMember(event.resource.id));
    if (member !== undefined) {
      await settleNonRetryableAction(() => handlers.onMemberCreated!(member, api));
    }
  } else if (event.event === "chat.changed" && handlers.onChatChanged !== undefined) {
    const chat = await authorizedDereference(
      () => api.getChat(event.resource.id, event.actor_id),
    );
    if (chat !== undefined) {
      await settleNonRetryableAction(
        () => handlers.onChatChanged!(chat, event.actor_id, api),
      );
    }
  }
}

async function authorizedDereference<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof BasstokApiError && (error.status === 403 || error.status === 404)) {
      return undefined;
    }
    throw error;
  }
}

async function settleNonRetryableAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof BasstokApiError && !error.retryable) {
      return;
    }
    throw error;
  }
}

class BodyTooLargeError extends Error {}
class BodyTimedOutError extends Error {}

async function readBody(
  request: IncomingMessage,
  maximumBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    request.destroy();
  }, timeoutMs);
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maximumBytes) throw new BodyTooLargeError();
      chunks.push(bytes);
    }
  } catch (error) {
    if (timedOut) throw new BodyTimedOutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  return Buffer.concat(chunks);
}

function oneHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${name} header`);
  }
  return value;
}

function positiveBound(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function boundedWebhookString(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes;
}
