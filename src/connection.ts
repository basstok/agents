import { BasstokClient, type WebhookEvent } from "./basstok.js";
import { atomicWriteProtected, CredentialFileLease, readProtectedFile } from "./credentials.js";
import {
  authorizeWithLoopback, completeGrantSetup, parseAgentScopes, revokeToken,
  type AgentScope,
} from "./oauth.js";
import { normalizeBasstokOrigin } from "./origin.js";

export const defaultConnectionFile = ".basstok-agent.json";

export interface AgentConnection {
  version: 1;
  origin: string;
  clientId: string;
  name: string;
  scopes: AgentScope[];
  event: WebhookEvent;
  webhookUrl: string;
  callbackPort: number;
  port: number;
}

export function validateConnection(value: unknown): AgentConnection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Agent connection");
  }
  const record = value as Record<string, unknown>;
  const keys = ["version", "origin", "clientId", "name", "scopes", "event",
    "webhookUrl", "callbackPort", "port"];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record)) ||
      record.version !== 1) throw new Error("Unsupported Agent connection format");
  for (const field of ["origin", "clientId", "name", "webhookUrl"] as const) {
    const maximum = field === "name" ? 120 : field === "clientId" ? 128 : 2_048;
    if (typeof record[field] !== "string" || record[field].length === 0 ||
        Buffer.byteLength(record[field], "utf8") > maximum || /[\x00-\x1f\x7f]/.test(record[field])) {
      throw new Error(`Invalid connection ${field}`);
    }
  }
  const connection = record as unknown as AgentConnection;
  if (normalizeBasstokOrigin(connection.origin) !== connection.origin) {
    throw new Error("Connection URL must be an exact Basstok origin");
  }
  const webhook = new URL(connection.webhookUrl);
  if (webhook.protocol !== "https:" || webhook.username || webhook.password || webhook.search || webhook.hash ||
      webhook.pathname !== "/webhooks/basstok") {
    throw new Error("Webhook URL must use HTTPS and end in /webhooks/basstok with no credentials, query or fragment");
  }
  if (!Array.isArray(connection.scopes) || !connection.scopes.every((scope) => typeof scope === "string")) {
    throw new Error("Invalid connection scopes");
  }
  parseAgentScopes(connection.scopes.join(" "), []);
  const readScope = {
    "content.changed": "content:read",
    "member.created": "member:read",
    "chat.changed": "chat:read",
  } as const;
  if (!Object.hasOwn(readScope, connection.event) ||
      !connection.scopes.includes(readScope[connection.event])) {
    throw new Error("The selected event requires its corresponding read scope");
  }
  for (const port of [connection.port, connection.callbackPort]) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error("Connection ports must be integers from 1 to 65535");
    }
  }
  if (connection.port === connection.callbackPort) {
    throw new Error("Webhook and callback ports must be different");
  }
  return connection;
}

export async function readConnection(path = defaultConnectionFile): Promise<AgentConnection> {
  return validateConnection(JSON.parse(await readProtectedFile(path, 16 * 1024)));
}

export async function connectAgent(
  connection: AgentConnection,
  options: {
    path?: string;
    onReady: (authorizationUrl: string, redirectUri: string) => void;
    timeoutMs?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  validateConnection(connection);
  const path = options.path ?? defaultConnectionFile;
  const lease = await CredentialFileLease.acquire(`${path}.credentials`);
  try {
    // Bind this directory to the requested connection before starting one-use OAuth work.
    await atomicWriteProtected(path, JSON.stringify(connection, null, 2) + "\n");
    await lease.writeAuthorizing({ basstokUrl: connection.origin, clientId: connection.clientId });
    const tokens = await authorizeWithLoopback(connection.origin, {
      clientId: connection.clientId,
      scopes: connection.scopes,
      port: connection.callbackPort,
      onReady: options.onReady,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }, fetchImpl);
    await completeGrantSetup(async () => {
      const approved = new Set(parseAgentScopes(tokens.scope, []));
      if (approved.size !== connection.scopes.length ||
          !connection.scopes.every((scope) => approved.has(scope))) {
        throw new Error("OAuth response did not contain the requested scope set");
      }
      const webhook = await new BasstokClient(connection.origin, tokens.access_token, fetchImpl)
        .putWebhook(connection.clientId, connection.clientId, {
          grant_id: tokens.grant_id,
          name: connection.name,
          endpoint: connection.webhookUrl,
          events: [connection.event],
        });
      await lease.writeAuthorized({
        basstokUrl: connection.origin, clientId: connection.clientId,
        tokens, webhookSecret: webhook.signing_secret,
      });
    }, () => revokeToken(connection.origin, tokens.access_token, connection.clientId, fetchImpl));
    return tokens.grant_id;
  } finally {
    await lease.release();
  }
}
