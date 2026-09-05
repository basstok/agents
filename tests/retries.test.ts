import assert from "node:assert/strict";
import test from "node:test";
import { BasstokApiError, BasstokClient } from "../src/basstok.js";
import { idempotencyKey } from "../src/ids.js";

test("REST retries preserve the exact create body and key and obtain current credentials", async () => {
  let calls = 0;
  let tokenReads = 0;
  const bodies: string[] = [];
  const keys: string[] = [];
  const client = new BasstokClient("https://community.example", {
    async accessToken() { return `fixture-${++tokenReads}`; },
  }, async (_url, init) => {
    ++calls;
    bodies.push(String(init?.body));
    keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer fixture-${calls}`);
    assert.equal(init?.redirect, "error");
    if (calls === 1) throw new TypeError("fetch failed");
    if (calls === 2) return Response.json({
      error: { code: "busy", message: "Try again", retryable: true },
    }, { status: 503 });
    return Response.json({ id: "created-chat" });
  });
  const key = idempotencyKey("retry/chat", "member");
  await client.createChat(key, { participant_ids: ["one", "two"] });
  assert.equal(calls, 3);
  assert.deepEqual(keys, [key, key, key]);
  assert.equal(new Set(bodies).size, 1);
});

test("REST retries stop after three attempts and do not retry a one-use POST", async () => {
  let calls = 0;
  const client = new BasstokClient("https://community.example", "fixture-token", async () => {
    ++calls;
    return new Response(null, { status: 503 });
  });
  await assert.rejects(client.getSession(), BasstokApiError);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(client.completeAssetUpload("upload"), BasstokApiError);
  assert.equal(calls, 1);
});

test("denials, typed conflicts, credential failures and malformed success are never retried", async () => {
  for (const status of [401, 403, 404, 409]) {
    let calls = 0;
    const client = new BasstokClient("https://community.example", "fixture-token", async () => {
      ++calls;
      return Response.json({ error: { code: "denied", message: "Denied", retryable: status !== 409 } }, { status });
    });
    await assert.rejects(client.getSession(), BasstokApiError);
    assert.equal(calls, 1);
  }
  let tokenReads = 0;
  const credentials = new BasstokClient("https://community.example", {
    async accessToken() { ++tokenReads; throw new Error("Reconnect required"); },
  }, async () => { throw new Error("Must not fetch"); });
  await assert.rejects(credentials.getSession(), /Reconnect/);
  assert.equal(tokenReads, 1);
  let calls = 0;
  const malformed = new BasstokClient("https://community.example", "fixture-token", async () => {
    ++calls;
    return new Response("not JSON");
  });
  await assert.rejects(malformed.getSession(), SyntaxError);
  assert.equal(calls, 1);
});

test("Retry-After is respected and delays beyond the request budget are not shortened", async () => {
  let calls = 0;
  const start = performance.now();
  const client = new BasstokClient("https://community.example", "fixture-token", async () => {
    if (++calls === 1) return new Response(null, { status: 429, headers: { "Retry-After": "1" } });
    assert.ok(performance.now() - start >= 990);
    return Response.json({ member_id: "member" });
  });
  await client.getSession();
  for (const value of ["60", new Date(Date.now() + 120_000).toUTCString()]) {
    calls = 0;
    const limited = new BasstokClient("https://community.example", "fixture-token", async () => {
      ++calls;
      return new Response(null, { status: 429, headers: { "Retry-After": value } });
    });
    await assert.rejects(limited.getSession(), BasstokApiError);
    assert.equal(calls, 1);
  }
});

test("authorized Asset reads and writes use the same bounded retry boundary", async () => {
  let calls = 0;
  const client = new BasstokClient("https://community.example", "fixture-token", async (_url, init) => {
    assert.equal(init?.redirect, "error");
    if (++calls === 1) return new Response(null, { status: 503 });
    return new Response(new Uint8Array([1, 2, 3]));
  });
  assert.deepEqual(await client.getAssetBytes("asset", { range: "bytes=0-2" }), new Uint8Array([1, 2, 3]));
  calls = 0;
  const writer = new BasstokClient("https://community.example", "fixture-token", async (_url, init) => {
    assert.deepEqual(init?.body, new Uint8Array([1, 2]));
    if (++calls === 1) throw new TypeError("fetch failed");
    return Response.json({ id: "upload" });
  });
  await writer.putAssetUploadPart("upload", 1, new Uint8Array([1, 2]));
  assert.equal(calls, 2);
});
