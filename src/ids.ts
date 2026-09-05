import { createHash } from "node:crypto";

const idempotencyKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A stable UUID-shaped ID for Content, Comment, or Member exact-ID creates. */
export function deterministicId(purpose: string, ...parts: string[]): string {
  return derivedUuid(5, purpose, parts);
}

/** A stable UUIDv4-shaped key for one retryable create attempt. */
export function idempotencyKey(purpose: string, ...parts: string[]): string {
  return derivedUuid(4, purpose, parts);
}

/** Whether a value can be sent as Basstok's create idempotency key. */
export function isIdempotencyKey(value: string): boolean {
  return idempotencyKeyPattern.test(value);
}

function derivedUuid(version: 4 | 5, purpose: string, parts: string[]): string {
  const hash = createHash("sha256");
  for (const value of [purpose, ...parts]) {
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
  }
  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | (version << 4);
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`;
}
