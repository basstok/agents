import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  parseAgentScopes,
  refreshAccessToken,
  type OAuthTokens,
} from "./oauth.js";
import { normalizeBasstokOrigin } from "./origin.js";

export const defaultCredentialsFile = ".basstok-agent.json.credentials";

export function assertProtectedCredentialFileSupport(
  platform: NodeJS.Platform,
): void {
  if (platform === "win32") {
    throw new Error(
      "The included credential-file helper requires POSIX owner-only file permissions and is not supported on Windows",
    );
  }
}

export class CredentialAuthorizationRequiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialAuthorizationRequiredError";
  }
}

interface ReadyCredentials {
  version: 1;
  state: "ready";
  basstok_url: string;
  client_id: string;
  grant_id: string;
  scope: string;
  access_token: string;
  access_token_issued_at_ms: number;
  access_token_expires_at_ms: number;
  refresh_token: string;
  webhook_secret: string;
}

interface RefreshingCredentials {
  version: 1;
  state: "refreshing";
  basstok_url: string;
  client_id: string;
  grant_id: string;
  scope: string;
  rotation_started_at_ms: number;
}

interface AuthorizingCredentials {
  version: 1;
  state: "authorizing";
  basstok_url: string;
  client_id: string;
  authorization_started_at_ms: number;
}

type CredentialState = ReadyCredentials | RefreshingCredentials | AuthorizingCredentials;

interface LeaseRecord {
  pid: number;
  nonce: string;
}

export class CredentialFileLease {
  readonly path: string;
  readonly #lockPath: string;
  readonly #nonce: string;
  #released = false;

  private constructor(path: string, nonce: string) {
    this.path = path;
    this.#lockPath = `${path}.lock`;
    this.#nonce = nonce;
  }

  static async acquire(path = defaultCredentialsFile): Promise<CredentialFileLease> {
    assertProtectedCredentialFileSupport(process.platform);
    const resolved = resolve(path);
    const lockPath = `${resolved}.lock`;
    const acquisitionPath = `${lockPath}.acquire`;
    const acquisitionNonce = randomBytes(16).toString("hex");
    await acquireGuard(acquisitionPath, acquisitionNonce, resolved);

    try {
      const nonce = randomBytes(16).toString("hex");
      try {
        await writeNewProtectedFile(lockPath, JSON.stringify({ pid: process.pid, nonce }) + "\n");
        return new CredentialFileLease(resolved, nonce);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }

      const existing = await readLease(lockPath);
      if (processIsAlive(existing.pid)) {
        throw new Error(`Credential file is already in use: ${resolved}`);
      }
      await unlink(lockPath);
      await writeNewProtectedFile(lockPath, JSON.stringify({ pid: process.pid, nonce }) + "\n");
      return new CredentialFileLease(resolved, nonce);
    } finally {
      await removeOwnedLease(acquisitionPath, acquisitionNonce);
    }
  }

  async writeAuthorized(input: {
    basstokUrl: string;
    clientId: string;
    tokens: OAuthTokens;
    webhookSecret: string;
    now?: number;
  }): Promise<void> {
    const now = input.now ?? Date.now();
    const ready = readyCredentials(input, now);
    await this.write(ready);
  }

  async writeAuthorizing(input: {
    basstokUrl: string;
    clientId: string;
    now?: number;
  }): Promise<void> {
    const now = input.now ?? Date.now();
    boundedInteger("current time", now, 0, Number.MAX_SAFE_INTEGER);
    boundedString("client ID", input.clientId, 1, 256);
    await this.write({
      version: 1,
      state: "authorizing",
      basstok_url: normalizeBasstokOrigin(input.basstokUrl),
      client_id: input.clientId,
      authorization_started_at_ms: now,
    });
  }

  async write(state: CredentialState): Promise<void> {
    if (this.#released) throw new Error("Credential file lease is closed");
    await atomicWriteProtected(this.path, JSON.stringify(state, null, 2) + "\n");
  }

  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    await removeOwnedLease(this.#lockPath, this.#nonce);
  }
}

export class RotatingCredentials {
  readonly #lease: CredentialFileLease;
  readonly #fetch: typeof fetch;
  #ready: ReadyCredentials;
  #rotation: Promise<string> | undefined;
  #failed = false;

  private constructor(
    lease: CredentialFileLease,
    ready: ReadyCredentials,
    fetchImpl: typeof fetch,
  ) {
    this.#lease = lease;
    this.#ready = ready;
    this.#fetch = fetchImpl;
  }

  static async open(
    path: string,
    expected: { basstokUrl: string; clientId: string },
    fetchImpl: typeof fetch = fetch,
  ): Promise<RotatingCredentials> {
    const lease = await CredentialFileLease.acquire(path);
    try {
      const state = await readCredentials(lease.path);
      if (state.state !== "ready") {
        throw new CredentialAuthorizationRequiredError(
          "OAuth authorization or refresh was interrupted; authorize the Agent again",
        );
      }
      if (state.basstok_url !== normalizeBasstokOrigin(expected.basstokUrl) ||
          state.client_id !== expected.clientId) {
        throw new Error("Credential file does not match this Agent and Basstok URL");
      }
      return new RotatingCredentials(lease, state, fetchImpl);
    } catch (error) {
      await lease.release();
      throw error;
    }
  }

  get webhookSecret(): string {
    return this.#ready.webhook_secret;
  }

  async accessToken(): Promise<string> {
    const now = Date.now();
    const lifetime = this.#ready.access_token_expires_at_ms -
      this.#ready.access_token_issued_at_ms;
    const skew = Math.min(30_000, Math.max(100, Math.floor(lifetime / 10)));
    if (!this.#failed && now < this.#ready.access_token_expires_at_ms - skew) {
      return this.#ready.access_token;
    }
    if (this.#rotation !== undefined) return this.#rotation;
    if (this.#failed) {
      throw new CredentialAuthorizationRequiredError(
        "OAuth credentials require authorization",
      );
    }
    this.#rotation = this.#rotate(now);
    try {
      return await this.#rotation;
    } finally {
      this.#rotation = undefined;
    }
  }

  async close(): Promise<void> {
    await this.#lease.release();
  }

  async #rotate(now: number): Promise<string> {
    const previous = this.#ready;
    const tombstone: RefreshingCredentials = {
      version: 1,
      state: "refreshing",
      basstok_url: previous.basstok_url,
      client_id: previous.client_id,
      grant_id: previous.grant_id,
      scope: previous.scope,
      rotation_started_at_ms: now,
    };
    try {
      await this.#lease.write(tombstone);
      const tokens = await refreshAccessToken(
        previous.basstok_url,
        previous.client_id,
        previous.refresh_token,
        this.#fetch,
      );
      if (tokens.grant_id !== previous.grant_id) {
        throw new Error("OAuth refresh returned a different grant");
      }
      if (!sameScopes(tokens.scope, previous.scope)) {
        throw new Error("OAuth refresh returned different scopes");
      }
      const ready = readyCredentials({
        basstokUrl: previous.basstok_url,
        clientId: previous.client_id,
        tokens,
        webhookSecret: previous.webhook_secret,
      }, Date.now());
      await this.#lease.write(ready);
      this.#ready = ready;
      return ready.access_token;
    } catch (error) {
      this.#failed = true;
      throw new CredentialAuthorizationRequiredError(
        "OAuth refresh did not complete; authorize the Agent again",
        { cause: error },
      );
    }
  }
}

function readyCredentials(
  input: {
    basstokUrl: string;
    clientId: string;
    tokens: OAuthTokens;
    webhookSecret: string;
  },
  now: number,
): ReadyCredentials {
  boundedInteger("current time", now, 0, Number.MAX_SAFE_INTEGER);
  boundedString("client ID", input.clientId, 1, 256);
  boundedString("grant ID", input.tokens.grant_id, 1, 256);
  boundedString("scope", input.tokens.scope, 1, 2_048);
  parseAgentScopes(input.tokens.scope, []);
  boundedSecret("access token", input.tokens.access_token);
  boundedSecret("refresh token", input.tokens.refresh_token);
  boundedSecret("webhook secret", input.webhookSecret);
  boundedInteger("token lifetime", input.tokens.expires_in, 0, 3_600);
  const expiresAt = now + input.tokens.expires_in * 1_000;
  if (!Number.isSafeInteger(expiresAt)) throw new Error("Token expiry is out of range");
  return {
    version: 1,
    state: "ready",
    basstok_url: normalizeBasstokOrigin(input.basstokUrl),
    client_id: input.clientId,
    grant_id: input.tokens.grant_id,
    scope: input.tokens.scope,
    access_token: input.tokens.access_token,
    access_token_issued_at_ms: now,
    access_token_expires_at_ms: expiresAt,
    refresh_token: input.tokens.refresh_token,
    webhook_secret: input.webhookSecret,
  };
}

async function readCredentials(path: string): Promise<CredentialState> {
  const text = await readProtectedFile(path, 64 * 1024);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Credential file is not valid JSON");
  }
  if (!isRecord(value) || value.version !== 1 ||
      (value.state !== "ready" && value.state !== "refreshing" &&
       value.state !== "authorizing")) {
    throw new Error("Credential file has an unsupported format");
  }
  if (value.state === "authorizing") {
    exactKeys(value, [
      "version", "state", "basstok_url", "client_id",
      "authorization_started_at_ms",
    ]);
    if (value.basstok_url !== normalizeBasstokOrigin(String(value.basstok_url))) {
      throw new Error("Credential Basstok URL is invalid");
    }
    boundedString("client ID", value.client_id, 1, 256);
    boundedInteger(
      "authorization time",
      value.authorization_started_at_ms,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    return value as unknown as AuthorizingCredentials;
  }
  if (value.state === "refreshing") {
    exactKeys(value, [
      "version", "state", "basstok_url", "client_id", "grant_id", "scope",
      "rotation_started_at_ms",
    ]);
    validateCommon(value);
    boundedInteger("rotation time", value.rotation_started_at_ms, 0, Number.MAX_SAFE_INTEGER);
    return value as unknown as RefreshingCredentials;
  }
  exactKeys(value, [
    "version", "state", "basstok_url", "client_id", "grant_id", "scope",
    "access_token", "access_token_issued_at_ms", "access_token_expires_at_ms",
    "refresh_token", "webhook_secret",
  ]);
  validateCommon(value);
  boundedSecret("access token", value.access_token);
  boundedSecret("refresh token", value.refresh_token);
  boundedSecret("webhook secret", value.webhook_secret);
  boundedInteger("token issue time", value.access_token_issued_at_ms, 0, Number.MAX_SAFE_INTEGER);
  boundedInteger("token expiry", value.access_token_expires_at_ms, 0, Number.MAX_SAFE_INTEGER);
  if (value.access_token_expires_at_ms < value.access_token_issued_at_ms ||
      value.access_token_expires_at_ms - value.access_token_issued_at_ms > 3_600_000) {
    throw new Error("Credential token expiry is invalid");
  }
  return value as unknown as ReadyCredentials;
}

function validateCommon(value: Record<string, unknown>): void {
  if (value.basstok_url !== normalizeBasstokOrigin(String(value.basstok_url))) {
    throw new Error("Credential Basstok URL is invalid");
  }
  boundedString("client ID", value.client_id, 1, 256);
  boundedString("grant ID", value.grant_id, 1, 256);
  boundedString("scope", value.scope, 1, 2_048);
  parseAgentScopes(value.scope, []);
}

async function readLease(path: string): Promise<LeaseRecord> {
  const text = await readProtectedFile(path, 4 * 1024);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Credential lock is malformed");
  }
  if (!isRecord(value)) throw new Error("Credential lock is malformed");
  exactKeys(value, ["pid", "nonce"]);
  boundedInteger("credential lock PID", value.pid, 1, 2 ** 31 - 1);
  boundedString("credential lock nonce", value.nonce, 32, 32);
  return value as unknown as LeaseRecord;
}

async function acquireGuard(path: string, nonce: string, credentialPath: string): Promise<void> {
  const record: LeaseRecord = { pid: process.pid, nonce };
  try {
    await writeNewProtectedFile(path, JSON.stringify(record) + "\n");
    return;
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }

  const existing = await readLease(path);
  if (processIsAlive(existing.pid)) {
    throw new Error(`Credential file acquisition is already in progress: ${credentialPath}`);
  }
  await removeMatchingLease(path, existing);
  try {
    await writeNewProtectedFile(path, JSON.stringify(record) + "\n");
  } catch (error) {
    if (hasCode(error, "EEXIST")) {
      throw new Error(`Credential file acquisition is already in progress: ${credentialPath}`);
    }
    throw error;
  }
}

export async function readProtectedFile(path: string, maximumBytes: number): Promise<string> {
  let handle: FileHandle;
  try {
    const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
    handle = await open(path, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (hasCode(error, "ELOOP")) throw new Error(`Protected file is invalid: ${path}`);
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new Error(`Protected file is invalid: ${path}`);
    }
    if (process.platform !== "win32") {
      if ((metadata.mode & 0o077) !== 0) {
        throw new Error(`Protected file permissions are too broad: ${path}`);
      }
      if (process.getuid !== undefined && metadata.uid !== process.getuid()) {
        throw new Error(`Protected file has a different owner: ${path}`);
      }
    }
    const bytes = Buffer.alloc(maximumBytes + 1);
    let used = 0;
    while (used < bytes.length) {
      const result = await handle.read(bytes, used, bytes.length - used, used);
      if (result.bytesRead === 0) break;
      used += result.bytesRead;
    }
    if (used > maximumBytes) throw new Error(`Protected file is invalid: ${path}`);
    return bytes.subarray(0, used).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function removeOwnedLease(path: string, nonce: string): Promise<void> {
  await removeMatchingLease(path, { pid: process.pid, nonce });
}

async function removeMatchingLease(path: string, expected: LeaseRecord): Promise<void> {
  try {
    const current = await readLease(path);
    if (current.nonce !== expected.nonce || current.pid !== expected.pid) {
      throw new Error("Credential file lease ownership changed");
    }
    await unlink(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

export async function atomicWriteProtected(path: string, text: string): Promise<void> {
  const temporary = resolve(
    dirname(path),
    `${basename(path)}.new-${randomBytes(12).toString("hex")}`,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function writeNewProtectedFile(path: string, text: string): Promise<void> {
  const temporary = `${path}.candidate-${randomBytes(12).toString("hex")}`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

function sameScopes(left: string, right: string): boolean {
  try {
    const leftScopes = parseAgentScopes(left, []);
    const rightScopes = new Set(parseAgentScopes(right, []));
    return leftScopes.length === rightScopes.size &&
      leftScopes.every((scope) => rightScopes.has(scope));
  } catch {
    return false;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("Protected file contains unexpected fields");
  }
}

function boundedSecret(name: string, value: unknown): asserts value is string {
  boundedString(name, value, 1, 8_192);
}

function boundedString(
  name: string,
  value: unknown,
  minimum: number,
  maximum: number,
): asserts value is string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < minimum ||
      Buffer.byteLength(value, "utf8") > maximum) {
    throw new Error(`${name} is invalid`);
  }
}

function boundedInteger(
  name: string,
  value: unknown,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < minimum || value > maximum) {
    throw new Error(`${name} is invalid`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as { code?: unknown }).code === code;
}
