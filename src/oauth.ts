import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { normalizeBasstokOrigin } from "./origin.js";

export interface OAuthTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
  grant_id: string;
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export const agentScopes = [
  "content:read",
  "content:write",
  "engagement:write",
  "member:read",
  "member:write",
  "chat:read",
  "chat:write",
  "moderation:write",
] as const;

export type AgentScope = typeof agentScopes[number];

export function isAgentScope(value: string): value is AgentScope {
  return (agentScopes as readonly string[]).includes(value);
}

export function parseAgentScopes(
  configured: string | undefined,
  fallback: readonly AgentScope[],
): AgentScope[] {
  const values = configured === undefined
    ? [...fallback]
    : configured.split(/\s+/).filter((value) => value.length > 0);
  if (values.length === 0 || !values.every(isAgentScope) ||
      new Set(values).size !== values.length) {
    throw new Error("Agent scopes contain an unsupported value");
  }
  return values;
}

export function createPkce(): Pkce {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizationUrl(
  origin: string,
  input: {
    clientId: string;
    redirectUri: string;
    scopes: AgentScope[];
    state: string;
    challenge: string;
  },
): string {
  const url = new URL("/oauth/authorize", normalizeBasstokOrigin(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function authorizeWithLoopback(
  origin: string,
  input: {
    clientId: string;
    scopes: AgentScope[];
    port: number;
    onReady: (authorizationUrl: string, redirectUri: string) => void;
    timeoutMs?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokens> {
  const basstokOrigin = normalizeBasstokOrigin(origin);
  const redirectUri = `http://127.0.0.1:${input.port}/callback`;
  const state = randomBytes(32).toString("base64url");
  const pkce = createPkce();
  const url = authorizationUrl(basstokOrigin, {
    clientId: input.clientId,
    redirectUri,
    scopes: input.scopes,
    state,
    challenge: pkce.challenge,
  });

  return new Promise<OAuthTokens>((resolve, reject) => {
    let finished = false;
    let callbackInFlight = false;
    let timer: NodeJS.Timeout | undefined;
    const server = createServer(async (request, response) => {
      try {
        const callback = new URL(request.url ?? "/", redirectUri);
        if (callback.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        if (callback.searchParams.get("state") !== state) {
          response.writeHead(400).end("OAuth state did not match.\n");
          return;
        }
        if (callbackInFlight) {
          response.writeHead(409).end("Authorization is already being completed.\n");
          return;
        }
        callbackInFlight = true;
        const error = callback.searchParams.get("error");
        if (error !== null) throw new Error(`Authorization failed: ${error}`);
        const issuer = callback.searchParams.get("iss");
        if (issuer !== basstokOrigin) {
          throw new Error("OAuth issuer did not match the Basstok URL");
        }
        const code = callback.searchParams.get("code");
        if (code === null) throw new Error("Authorization response has no code");

        const tokens = await exchangeAuthorizationCode(basstokOrigin, {
          clientId: input.clientId,
          code,
          redirectUri,
          verifier: pkce.verifier,
        }, fetchImpl);
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Authorization complete. Return to the terminal.\n");
        finish(undefined, tokens);
      } catch (error) {
        response.writeHead(500).end("Authorization could not be completed.\n");
        finish(error);
      }
    });

    const finish = (error?: unknown, tokens?: OAuthTokens): void => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      server.close();
      if (error !== undefined) reject(error);
      else if (tokens !== undefined) resolve(tokens);
    };

    server.once("error", finish);
    server.listen(input.port, "127.0.0.1", () => input.onReady(url, redirectUri));
    timer = setTimeout(
      () => finish(new Error("Authorization timed out")),
      input.timeoutMs ?? 10 * 60 * 1_000,
    );
    timer.unref();
  });
}

export async function exchangeAuthorizationCode(
  origin: string,
  input: {
    clientId: string;
    code: string;
    redirectUri: string;
    verifier: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokens> {
  return tokenRequest(origin, {
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  }, fetchImpl);
}

export async function refreshAccessToken(
  origin: string,
  clientId: string,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokens> {
  return tokenRequest(origin, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  }, fetchImpl);
}

export async function revokeToken(
  origin: string,
  token: string,
  clientId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const form = new URLSearchParams({ token });
  if (clientId !== undefined) form.set("client_id", clientId);
  const response = await fetchImpl(
    new URL("/oauth/revoke", normalizeBasstokOrigin(origin)),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: oauthRequestSignal(),
    },
  );
  if (!response.ok) throw new Error(`OAuth revocation failed with ${response.status}`);
}

export async function completeGrantSetup<T>(
  setup: () => Promise<T>,
  revoke: () => Promise<void>,
): Promise<T> {
  try {
    return await setup();
  } catch (setupError) {
    try {
      await revoke();
    } catch (revocationError) {
      throw new AggregateError(
        [setupError, revocationError],
        "Agent setup failed and OAuth revocation could not be confirmed",
      );
    }
    throw setupError;
  }
}

async function tokenRequest(
  origin: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<OAuthTokens> {
  const response = await fetchImpl(new URL("/oauth/token", normalizeBasstokOrigin(origin)), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    signal: oauthRequestSignal(),
  });
  const text = await readBoundedText(response, 64 * 1024);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("OAuth token response is not valid JSON");
  }
  if (!response.ok) {
    const error = isRecord(value) && typeof value.error_description === "string"
      ? value.error_description.slice(0, 1_024)
      : `OAuth token request failed with ${response.status}`;
    throw new Error(error);
  }
  return validateOAuthTokens(value);
}

function oauthRequestSignal(): AbortSignal {
  return AbortSignal.timeout(30_000);
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximumBytes) {
    await response.body?.cancel();
    throw new Error("OAuth token response is too large");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("OAuth token response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

export function validateOAuthTokens(value: unknown): OAuthTokens {
  if (!isRecord(value) || value.token_type !== "Bearer" ||
      !boundedString(value.access_token, 8_192) ||
      !boundedString(value.refresh_token, 8_192) ||
      !validScopeText(value.scope) ||
      !boundedString(value.grant_id, 256) ||
      typeof value.expires_in !== "number" ||
      !Number.isSafeInteger(value.expires_in) || value.expires_in < 0 ||
      value.expires_in > 3_600) {
    throw new Error("OAuth token response is invalid");
  }
  return value as unknown as OAuthTokens;
}

function validScopeText(value: unknown): value is string {
  if (!boundedString(value, 2_048)) return false;
  try {
    parseAgentScopes(value, []);
    return true;
  } catch {
    return false;
  }
}

function boundedString(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
