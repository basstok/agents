import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createConnection, type AddressInfo } from "node:net";
import test from "node:test";

import {
  createAgentWebhookServer,
  dispatchAgentWebhook,
  parseWebhook,
  verifyWebhook,
} from "../src/webhooks.js";
import { BasstokApiError, BasstokClient } from "../src/basstok.js";

test("webhook verification covers the delivery metadata and exact body", () => {
  const secret = "test-secret";
  const id = "delivery-1";
  const timestamp = "2026-09-02T00:00:00Z";
  const body = Buffer.from(JSON.stringify({
    id,
    event: "content.changed",
    occurred_at: timestamp,
    organization_id: "organization",
    resource: { type: "Content", id: "content" },
  }));
  const signature = "v1=" + createHmac("sha256", secret)
    .update(`v1\n${id}\n${timestamp}\n`)
    .update(body)
    .digest("hex");

  assert.equal(verifyWebhook(secret, { id, timestamp, signature }, body), true);
  assert.equal(
    verifyWebhook(secret, { id, timestamp, signature }, Buffer.from("{}")),
    false,
  );
  assert.equal(parseWebhook(body).resource.id, "content");
});

test("the public webhook vocabulary rejects unknown resources", () => {
  const unsupportedEvent = Buffer.from(JSON.stringify({
    id: "delivery-2",
    event: "unsupported.changed",
    occurred_at: "2026-09-02T00:00:00Z",
    organization_id: "organization",
    resource: { type: "Unsupported", id: "private-resource" },
  }));
  assert.throws(() => parseWebhook(unsupportedEvent));
});

test("webhook reference fields and direct parser input are bounded", () => {
  assert.throws(() => parseWebhook(Buffer.from(deliveryBody("x".repeat(257)))));
  assert.throws(() => parseWebhook(Buffer.from(JSON.stringify({
    id: "delivery",
    event: "chat.changed",
    occurred_at: "2026-09-02T00:00:00Z",
    organization_id: "organization",
    resource: { type: "Chat", id: "chat" },
    actor_id: "x".repeat(129),
  }))));
  assert.throws(() => parseWebhook(Buffer.alloc(64 * 1024 + 1)));
});

test("reference-only Member and controlled Chat webhook events are typed", () => {
  const member = parseWebhook(Buffer.from(JSON.stringify({
    id: "delivery-member",
    event: "member.created",
    occurred_at: "2026-09-02T00:00:00Z",
    organization_id: "organization",
    resource: { type: "Member", id: "member" },
  })));
  assert.equal(member.resource.type, "Member");

  const chat = parseWebhook(Buffer.from(JSON.stringify({
    id: "delivery-chat",
    event: "chat.changed",
    occurred_at: "2026-09-02T00:00:00Z",
    organization_id: "organization",
    resource: { type: "Chat", id: "chat" },
    actor_id: "persona",
  })));
  assert.equal(chat.resource.type, "Chat");
  assert.equal(chat.actor_id, "persona");
});

test("webhook event and resource types must agree", () => {
  const mismatched = Buffer.from(JSON.stringify({
    id: "delivery-mismatch",
    event: "chat.changed",
    occurred_at: "2026-09-02T00:00:00Z",
    organization_id: "organization",
    resource: { type: "Content", id: "content" },
  }));
  assert.throws(() => parseWebhook(mismatched));
});

test("capability handlers receive a current REST representation", async () => {
  const requests: string[] = [];
  const api = new BasstokClient("https://community.example", "token", async (input) => {
    requests.push(input.toString());
    return Response.json({
      id: "content",
      title: "Current title",
      body: "Current body",
      labels: [],
      system_labels: [],
      authorship: {},
      engagement: { views: 0 },
      assets: [],
    });
  });
  let observedTitle = "";

  await dispatchAgentWebhook(parseWebhook(Buffer.from(deliveryBody("delivery"))), {
    name: "Test Agent",
    onContentChanged: async (content) => { observedTitle = content.title; },
  }, api);

  assert.equal(observedTitle, "Current title");
  assert.deepEqual(requests, ["https://community.example/api/v1/contents/content"]);
});

test("revoked or removed resources settle before a capability handler runs", async () => {
  for (const status of [403, 404]) {
    const api = new BasstokClient("https://community.example", "token", async () =>
      Response.json({
        error: {
          code: status === 403 ? "access_denied" : "not_found",
          message: "Unavailable",
          retryable: false,
        },
      }, { status })
    );
    let handled = false;
    await dispatchAgentWebhook(parseWebhook(Buffer.from(deliveryBody(`delivery-${status}`))), {
      name: "Test Agent",
      onContentChanged: async () => { handled = true; },
    }, api);
    assert.equal(handled, false);
  }
});

test("non-retryable capability mutations settle while retryable conflicts do not", async () => {
  const api = new BasstokClient("https://community.example", "token", async () =>
    Response.json({
      id: "content",
      title: "Current title",
      body: "Current body",
      labels: [],
      system_labels: [],
      authorship: {},
      engagement: { views: 0 },
      assets: [],
    })
  );

  for (const status of [403, 404, 409]) {
    await dispatchAgentWebhook(parseWebhook(Buffer.from(deliveryBody(`delivery-${status}`))), {
      name: "Test Agent",
      onContentChanged: async () => {
        throw new BasstokApiError(status, "unavailable", "Unavailable", false);
      },
    }, api);
  }

  for (const [status, code] of [[409, "update_in_progress"], [500, "temporary"]] as const) {
    await assert.rejects(
      dispatchAgentWebhook(parseWebhook(Buffer.from(deliveryBody(`delivery-${status}-${code}`))), {
      name: "Test Agent",
      onContentChanged: async () => {
          throw new BasstokApiError(status, code, "Temporary", true);
      },
    }, api),
      (error: unknown) => error instanceof BasstokApiError && error.status === status,
    );
  }
});

test("a malformed upstream 429 cannot settle a capability delivery", async () => {
  let requestNumber = 0;
  const api = new BasstokClient("https://community.example", "token", async () => {
    ++requestNumber;
    if (requestNumber === 1) {
      return Response.json({
        id: "content",
        title: "Current title",
        body: "Current body",
        labels: [],
        system_labels: [],
        authorship: {},
        engagement: { views: 0 },
        assets: [],
      });
    }
    return new Response("temporary proxy response", { status: 429 });
  });

  await assert.rejects(
    dispatchAgentWebhook(parseWebhook(Buffer.from(deliveryBody("delivery-proxy-429"))), {
      name: "Test Agent",
      onContentChanged: async (content, client) => {
        await client.setFeatured(content.id, true);
      },
    }, api),
    (error: unknown) => error instanceof BasstokApiError &&
      error.status === 429 && error.retryable,
  );
});

test("webhook server bounds input, verifies delivery, and retries unsettled work", async () => {
  let attempts = 0;
  const errors: unknown[] = [];
  const server = createAgentWebhookServer({
    secret: "webhook-secret",
    maximumBodyBytes: 512,
    onError: (error) => errors.push(error),
    onEvent: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
    },
  });
  await listen(server);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const health = await fetch(`${origin}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok\n");

    const oversized = await fetch(`${origin}/webhooks/basstok`, {
      method: "POST",
      body: "x".repeat(513),
    });
    assert.equal(oversized.status, 413);

    const unauthorized = await fetch(`${origin}/webhooks/basstok`, {
      method: "POST",
      headers: deliveryHeaders("wrong-secret", "delivery"),
      body: deliveryBody("delivery"),
    });
    assert.equal(unauthorized.status, 401);

    const mismatchedBody = deliveryBody("body-delivery");
    const mismatched = await fetch(`${origin}/webhooks/basstok`, {
      method: "POST",
      headers: deliveryHeaders("webhook-secret", "header-delivery", mismatchedBody),
      body: mismatchedBody,
    });
    assert.equal(mismatched.status, 400);

    const first = await postDelivery(origin, "delivery");
    const retry = await postDelivery(origin, "delivery");
    const duplicate = await postDelivery(origin, "delivery");
    assert.deepEqual([first.status, retry.status, duplicate.status], [500, 204, 204]);
    assert.equal(attempts, 2);
    assert.equal(errors.length, 1);
  } finally {
    await close(server);
  }
});

test("webhook listener bounds sockets and closes a stalled request", async () => {
  const server = createAgentWebhookServer({
    secret: "webhook-secret",
    maximumConnections: 3,
    requestTimeoutMs: 40,
    onEvent: async () => undefined,
  });
  assert.equal(server.maxConnections, 3);
  assert.equal(server.requestTimeout, 40);
  await listen(server);
  const port = (server.address() as AddressInfo).port;
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.on("error", () => undefined);

  try {
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    socket.write(
      "POST /webhooks/basstok HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\nContent-Length: 100\r\n\r\n{",
    );
    await Promise.race([
      closed,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("stalled webhook was not closed")), 1_000);
      }),
    ]);
  } finally {
    socket.destroy();
    await close(server);
  }
});

test("webhook server bounds concurrent distinct deliveries", async () => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const work = new Promise<void>((resolve) => { release = resolve; });
  const server = createAgentWebhookServer({
    secret: "webhook-secret",
    maximumActiveDeliveries: 1,
    onEvent: async () => {
      started?.();
      await work;
    },
  });
  await listen(server);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const first = postDelivery(origin, "first");
    await startedPromise;
    const busy = await postDelivery(origin, "second");
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get("retry-after"), "1");
    release?.();
    assert.equal((await first).status, 204);
  } finally {
    release?.();
    await close(server);
  }
});

test("different deliveries for one resource execute in arrival order", async () => {
  let releaseFirst: (() => void) | undefined;
  let firstStarted: (() => void) | undefined;
  const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
  const firstWork = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const order: string[] = [];
  const server = createAgentWebhookServer({
    secret: "webhook-secret",
    onEvent: async (event) => {
      order.push(`start:${event.id}`);
      if (event.id === "first") {
        firstStarted?.();
        await firstWork;
      }
      order.push(`finish:${event.id}`);
    },
  });
  await listen(server);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const first = postDelivery(origin, "first");
    await firstStartedPromise;
    const second = postDelivery(origin, "second");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["start:first"]);
    releaseFirst?.();
    assert.deepEqual([(await first).status, (await second).status], [204, 204]);
    assert.deepEqual(order, [
      "start:first", "finish:first", "start:second", "finish:second",
    ]);
  } finally {
    releaseFirst?.();
    await close(server);
  }
});

function deliveryBody(id: string): string {
  return JSON.stringify({
    id,
    event: "content.changed",
    occurred_at: "2026-09-02T00:00:00Z",
    organization_id: "organization",
    resource: { type: "Content", id: "content" },
  });
}

function deliveryHeaders(
  secret: string,
  id: string,
  body = deliveryBody(id),
): Record<string, string> {
  const timestamp = "2026-09-02T00:00:00Z";
  return {
    "Basstok-Webhook-Id": id,
    "Basstok-Webhook-Timestamp": timestamp,
    "Basstok-Webhook-Signature": "v1=" + createHmac("sha256", secret)
      .update(`v1\n${id}\n${timestamp}\n`)
      .update(body)
      .digest("hex"),
  };
}

function postDelivery(origin: string, id: string): Promise<Response> {
  return fetch(`${origin}/webhooks/basstok`, {
    method: "POST",
    headers: deliveryHeaders("webhook-secret", id),
    body: deliveryBody(id),
  });
}

function listen(server: ReturnType<typeof createAgentWebhookServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server: ReturnType<typeof createAgentWebhookServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
