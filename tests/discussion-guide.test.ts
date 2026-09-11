import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { discussionGuide } from "../agents/discussion-guide.js";
import { BasstokApiError, BasstokClient, type Content } from "../src/basstok.js";
import { deterministicId } from "../src/ids.js";
import { createAgentWebhookServer, dispatchAgentWebhook } from "../src/webhooks.js";

const post: Content = {
  id: "post", title: "Help with my camera", body: "What should I try?",
  labels: [{ id: "help" }], system_labels: [], authorship: { member_id: "author", display_name: "Alex" },
  engagement: { views: 0 }, assets: [],
};
const guidance = "**To help others answer:** include what you tried and what happened.";
const commentId = deterministicId("discussion-guide/comment", post.id, "help");

test("guide settings are bounded and invalid settings fail before serving", () => {
  for (const label of ["", " ", "help\n", "two labels", "x".repeat(129)]) {
    assert.throws(() => discussionGuide(label, guidance));
  }
  for (const body of ["", " \n\t", "x\0", "x".repeat(2_049), "🙂".repeat(513)]) {
    assert.throws(() => discussionGuide("help", body));
  }
  assert.doesNotThrow(() => discussionGuide("help", "🙂".repeat(512)));
  assert.doesNotThrow(() => discussionGuide("help", "**Details**\n\n- First\n- Second"));
});

test("guide skips unrelated, paused and withheld Content without making requests", async () => {
  const api = new BasstokClient("https://community.example", "fixture-token", async () => {
    assert.fail("No request expected");
  });
  const handle = discussionGuide("help", guidance);
  await handle({ ...post, labels: [] }, api);
  for (const label of ["replies_paused", "hidden", "needs_review"] as const) {
    await handle({ ...post, system_labels: [label] }, api);
  }
});

test("a guide uses create-only identity and keeps edited replies across restarts/configuration changes", async () => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  let existing: { id: string; body: string } | undefined;
  const api = new BasstokClient("https://community.example", "fixture-token", async (input, init) => {
    const path = new URL(input.toString()).pathname;
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-token");
    if (method === "GET") {
      assert.equal(path, `/api/v1/contents/post/comments/${commentId}`);
      return existing === undefined ? missing() : Response.json(existing);
    }
    assert.equal(method, "PUT");
    assert.equal(path, `/api/v1/contents/post/comment-creations/${commentId}`);
    assert.deepEqual(body, { body: guidance });
    existing = { id: commentId, body: guidance };
    return Response.json(existing);
  });
  await discussionGuide("help", guidance)(post, api);
  assert.ok(existing);
  existing.body = "Human-edited guidance";
  // A new handler has no process-local deduplication state.
  await discussionGuide("help", "New wording for future posts")(post, api);
  assert.equal(existing.body, "Human-edited guidance");
  assert.deepEqual(requests.map(({ method }) => method), ["GET", "PUT", "GET"]);
});

test("guide propagates access denial and does not treat it as a missing Comment", async () => {
  let calls = 0;
  const api = new BasstokClient("https://community.example", "fixture-token", async () => {
    ++calls;
    return Response.json({ error: { code: "forbidden", message: "Forbidden", retryable: false } }, { status: 403 });
  });
  await assert.rejects(discussionGuide("help", guidance)(post, api),
    (error) => error instanceof BasstokApiError && error.status === 403);
  assert.equal(calls, 1);
});

test("signed delivery dereferences current Content; replay, restart and revocation do not duplicate guides", async () => {
  const secret = "fixture-guide-signing-secret";
  let existing = false;
  let writes = 0;
  let reads = 0;
  let revoked = false;
  const api = new BasstokClient("https://community.example", "fixture-token", async (input, init) => {
    assert.equal(new URL(input.toString()).origin, "https://community.example");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-token");
    const path = new URL(input.toString()).pathname;
    if (path === "/api/v1/contents/post") {
      ++reads;
      if (revoked) return Response.json({ error: { code: "forbidden", message: "Forbidden", retryable: false } }, { status: 403 });
      return Response.json(post);
    }
    if (path === `/api/v1/contents/post/comments/${commentId}`) {
      return existing ? Response.json({ id: commentId }) : missing();
    }
    assert.equal(path, `/api/v1/contents/post/comment-creations/${commentId}`);
    assert.equal(init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(init.body)), { body: guidance });
    existing = true;
    ++writes;
    return Response.json({ id: commentId });
  });
  const makeReceiver = () => createAgentWebhookServer({
    secret,
    onEvent: (event) => dispatchAgentWebhook(event, {
      name: "Discussion guide", onContentChanged: discussionGuide("help", guidance),
    }, api),
  });
  const send = async (origin: string, id: string, valid = true) => {
    const timestamp = "2026-09-11T00:00:00Z";
    const body = JSON.stringify({ id, occurred_at: timestamp, organization_id: "fixture-organization",
      event: "content.changed", resource: { type: "Content", id: "post" } });
    const signature = createHmac("sha256", valid ? secret : "wrong-fixture-secret")
      .update(`v1\n${id}\n${timestamp}\n${body}`).digest("hex");
    const response = await fetch(`${origin}/webhooks/basstok`, {
      method: "POST", body, headers: { "content-type": "application/json",
        "basstok-webhook-id": id, "basstok-webhook-timestamp": timestamp,
        "basstok-webhook-signature": `v1=${signature}` },
    });
    await response.arrayBuffer();
    return response.status;
  };
  let receiver = makeReceiver();
  try {
    let origin = await listen(receiver);
    assert.equal(await send(origin, "bad-signature", false), 401);
    assert.equal(reads, 0);
    assert.equal(await send(origin, "first"), 204);
    assert.equal(await send(origin, "first"), 204);
    assert.equal(writes, 1);
    assert.equal(reads, 1);
    await close(receiver);
    receiver = makeReceiver();
    origin = await listen(receiver);
    assert.equal(await send(origin, "first"), 204);
    assert.equal(writes, 1);
    revoked = true;
    assert.equal(await send(origin, "after-revocation"), 204);
    assert.equal(writes, 1);
  } finally {
    await close(receiver);
  }
});

function missing(): Response {
  return Response.json({ error: { code: "not_found", message: "Not found", retryable: false } }, { status: 404 });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
