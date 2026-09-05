import assert from "node:assert/strict";
import test from "node:test";

import { BasstokApiError, BasstokClient } from "../src/basstok.js";

test("BasstokClient sends a bearer-authenticated task mutation", async () => {
  let observedUrl = "";
  let observedAuthorization = "";
  let observedBody = "";
  const fetchMock: typeof fetch = async (input, init) => {
    observedUrl = input.toString();
    observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    observedBody = String(init?.body);
    return new Response(JSON.stringify({
      id: "content/one",
      title: "Resolved",
      body: "Done",
      labels: [],
      system_labels: ["replies_paused"],
    }), { status: 200 });
  };

  const client = new BasstokClient("https://community.example", "token", fetchMock);
  await client.pauseReplies("content/one");

  assert.equal(
    observedUrl,
    "https://community.example/api/v1/contents/content%2Fone/replies",
  );
  assert.equal(observedAuthorization, "Bearer token");
  assert.deepEqual(JSON.parse(observedBody), { paused: true });
});

test("BasstokClient requires HTTPS except for a loopback development origin", () => {
  assert.throws(() => new BasstokClient("http://community.example", "token"), /HTTPS/);
  assert.throws(() => new BasstokClient("https://community.example/path", "token"), /origin/);
  assert.doesNotThrow(() => new BasstokClient("http://127.0.0.1:8080", "token"));
});

test("BasstokClient bounds requests, JSON responses, and buffered Assets", async () => {
  let signal: AbortSignal | null | undefined;
  const oversized = new BasstokClient("https://community.example", "token", async (_input, init) => {
    signal = init?.signal;
    return new Response(null, { headers: { "Content-Length": String(72 * 1024 * 1024 + 1) } });
  });
  await assert.rejects(oversized.getSession(), /too large/);
  assert.ok(signal instanceof AbortSignal);

  const largeBody = "x".repeat(70 * 1024);
  const largeContent = new BasstokClient("https://community.example", "token", async () =>
    Response.json({
      id: "large-content",
      title: "Large Content",
      body: largeBody,
      labels: [],
      system_labels: [],
      authorship: {},
      engagement: { views: 0 },
      assets: [],
    })
  );
  assert.equal((await largeContent.getContent("large-content")).body.length, largeBody.length);

  let requested = false;
  const assets = new BasstokClient("https://community.example", "token", async () => {
    requested = true;
    return Response.json({});
  });
  await assert.rejects(assets.createSmallAsset(
    "11111111-1111-4111-8111-111111111111",
    { content_id: "content" },
    {
      name: "large.bin",
      media_type: "application/octet-stream",
      bytes: new Uint8Array(8 * 1024 * 1024 + 1),
    },
  ), /exceeds 8 MiB/);
  assert.equal(requested, false);
});

test("BasstokClient creates a server-identified Asset in an exact Content draft", async () => {
  let observedUrl = "";
  let observedBody: BodyInit | null | undefined;
  let observedMethod = "";
  let observedIdempotencyKey = "";
  const client = new BasstokClient(
    "https://community.example",
    "token",
    async (input, init) => {
      observedUrl = input.toString();
      observedBody = init?.body;
      observedMethod = init?.method ?? "GET";
      observedIdempotencyKey =
        new Headers(init?.headers).get("idempotency-key") ?? "";
      return Response.json({
        id: "asset",
        name: "cover.png",
        media_type: "image/png",
        size: 3,
        sha256: "0".repeat(64),
        integrity: { chunk_size: 16_777_216, chunk_sha256: [] },
      });
    },
  );
  const bytes = new Uint8Array([1, 2, 3]);

  const key = "44444444-4444-4444-8444-444444444444";
  const asset = await client.createContentDraftSmallAsset("draft", key, {
    name: "cover.png",
    media_type: "image/png",
    bytes,
  });

  assert.equal(
    observedUrl,
    "https://community.example/api/v1/content-drafts/draft/assets" +
      "?name=cover.png&media_type=image%2Fpng",
  );
  assert.equal(observedMethod, "POST");
  assert.equal(observedIdempotencyKey, key);
  assert.equal(observedBody, bytes);
  assert.equal(asset.id, "asset");
});

test("BasstokClient follows server-assigned multipart upload identities", async () => {
  const observed: Array<{
    method: string;
    url: string;
    idempotencyKey: string | null;
    body: BodyInit | null | undefined;
  }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const url = input.toString();
    observed.push({
      method,
      url,
      idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      body: init?.body,
    });
    if (method === "POST" && url.endsWith("/api/v1/assets/uploads")) {
      return Response.json({
        id: "upload-from-server",
        asset_id: "asset-from-server",
        part_size: 4,
        uploaded_parts: [],
        completed: false,
        aborted: false,
      }, { status: 201 });
    }
    if (method === "PUT" && url.endsWith("/parts/1")) {
      return Response.json({
        id: "upload-from-server",
        asset_id: "asset-from-server",
        part_size: 4,
        uploaded_parts: [1],
        completed: false,
        aborted: false,
      });
    }
    return Response.json({
      id: "asset-from-server",
      name: "recording.bin",
      media_type: "application/octet-stream",
      size: 4,
      sha256: "0".repeat(64),
      integrity: { chunk_size: 16_777_216, chunk_sha256: [] },
    });
  };
  const client = new BasstokClient(
    "https://community.example",
    "token",
    fetchMock,
  );
  const key = "55555555-5555-4555-8555-555555555555";

  const upload = await client.beginAssetUpload(key, {
    chat_id: "chat",
    name: "recording.bin",
    media_type: "application/octet-stream",
    size: 4,
    sha256: "0".repeat(64),
    attach_to_parent: true,
  });
  await client.putAssetUploadPart(upload.id, 1, new Uint8Array([1, 2, 3, 4]));
  const asset = await client.completeAssetUpload(upload.id);

  assert.equal(upload.id, "upload-from-server");
  assert.equal(upload.asset_id, "asset-from-server");
  assert.equal(asset.id, upload.asset_id);
  assert.equal(observed[0]?.method, "POST");
  assert.equal(observed[0]?.url, "https://community.example/api/v1/assets/uploads");
  assert.equal(observed[0]?.idempotencyKey, key);
  assert.deepEqual(JSON.parse(String(observed[0]?.body)), {
    chat_id: "chat",
    name: "recording.bin",
    media_type: "application/octet-stream",
    size: 4,
    sha256: "0".repeat(64),
    attach_to_parent: true,
  });
  assert.equal(
    observed[1]?.url,
    "https://community.example/api/v1/assets/uploads/upload-from-server/parts/1",
  );
  assert.equal(observed[1]?.idempotencyKey, null);
  assert.equal(
    observed[2]?.url,
    "https://community.example/api/v1/assets/uploads/upload-from-server/complete",
  );
});

test("BasstokClient rejects malformed create idempotency keys before I/O", async () => {
  let requested = false;
  const client = new BasstokClient(
    "https://community.example",
    "token",
    async () => {
      requested = true;
      return Response.json({});
    },
  );
  const bytes = new Uint8Array([1]);

  await assert.rejects(client.createChat("not-a-key", {
    participant_ids: ["member-a", "member-b"],
  }), /lowercase UUIDv4/);
  await assert.rejects(client.sendMessage("chat", "not-a-key", {
    body: "Hello",
  }), /lowercase UUIDv4/);
  await assert.rejects(client.createSmallAsset(
    "not-a-key",
    { content_id: "content" },
    { name: "a.txt", media_type: "text/plain", bytes },
  ), /lowercase UUIDv4/);
  await assert.rejects(client.createContentDraftSmallAsset(
    "draft",
    "not-a-key",
    { name: "a.txt", media_type: "text/plain", bytes },
  ), /lowercase UUIDv4/);
  await assert.rejects(client.beginAssetUpload("not-a-key", {
    name: "a.txt",
    media_type: "text/plain",
    size: 1,
    sha256: "0".repeat(64),
  }), /lowercase UUIDv4/);
  assert.equal(requested, false);
});

test("BasstokClient obtains the current access token for every request", async () => {
  const authorization: string[] = [];
  let tokenNumber = 0;
  const client = new BasstokClient(
    "https://community.example",
    { accessToken: async () => `token-${++tokenNumber}` },
    async (_input, init) => {
      authorization.push(new Headers(init?.headers).get("authorization") ?? "");
      return Response.json({ member_id: "member", display_name: "Member" });
    },
  );

  await client.getSession();
  await client.getSession();
  assert.deepEqual(authorization, ["Bearer token-1", "Bearer token-2"]);
});

test("BasstokClient preserves the public error envelope", async () => {
  const fetchMock: typeof fetch = async () => new Response(JSON.stringify({
    error: {
      code: "rate_limited",
      message: "Try again later",
      retryable: true,
    },
  }), { status: 429 });
  const client = new BasstokClient("https://community.example", "token", fetchMock);

  await assert.rejects(client.getContent("content"), (error: unknown) => {
    if (!(error instanceof BasstokApiError)) return false;
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryable, true);
    return true;
  });
});

test("BasstokClient retries malformed transient errors without trusting their shape", async () => {
  for (const status of [409, 429, 502]) {
    const client = new BasstokClient(
      "https://community.example",
      "token",
      async () => new Response("upstream error", { status }),
    );
    await assert.rejects(client.getContent("content"), (error: unknown) => {
      return error instanceof BasstokApiError && error.status === status &&
        error.code === "request_failed" && error.retryable;
    });
  }

  const malformedDenial = new BasstokClient(
    "https://community.example",
    "token",
    async () => Response.json({ error: null }, { status: 403 }),
  );
  await assert.rejects(malformedDenial.getContent("content"), (error: unknown) =>
    error instanceof BasstokApiError && !error.retryable);
});

test("BasstokClient keeps Content write authority separate from read authority", async () => {
  const observed: Array<{ url: string; body: unknown }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = input.toString();
    observed.push({
      url,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return Response.json({
      id: url.includes("/comments/") || url.includes("/comment-creations/")
        ? "comment"
        : "content",
    });
  };
  const client = new BasstokClient("https://community.example", "token", fetchMock);

  const written = await client.putContent("content", {
    title: "Write-only update",
    body: "The response need not disclose this body.",
    labels: ["selected"],
  });
  const draft = await client.putContentDraft("draft", {
    title: "Write-only draft",
    body: "This representation is not returned.",
    labels: ["selected"],
  });
  const published = await client.publishContent("draft");
  const moderated = await client.setModeration("content", "needs_review");
  const audience = await client.setContentAudience("content", "members_only");
  const writtenComment = await client.putComment("content", "new-comment", {
    body: "A write-only Comment response.",
  });
  const createdComment = await client.createComment("content", "receipt", {
    body: "A retry-safe Comment creation.",
  });
  const comment = await client.setCommentModeration("content", "comment", "hidden");

  assert.deepEqual(written, { id: "content" });
  assert.deepEqual(draft, { id: "content" });
  assert.deepEqual(published, { id: "content" });
  assert.deepEqual(moderated, { id: "content" });
  assert.deepEqual(audience, { id: "content" });
  assert.deepEqual(writtenComment, { id: "comment" });
  assert.deepEqual(createdComment, { id: "comment" });
  assert.deepEqual(comment, { id: "comment" });
  assert.deepEqual(observed, [
    {
      url: "https://community.example/api/v1/contents/content",
      body: {
        title: "Write-only update",
        body: "The response need not disclose this body.",
        labels: ["selected"],
      },
    },
    {
      url: "https://community.example/api/v1/content-drafts/draft",
      body: {
        title: "Write-only draft",
        body: "This representation is not returned.",
        labels: ["selected"],
      },
    },
    {
      url: "https://community.example/api/v1/content-drafts/draft/publish",
      body: undefined,
    },
    {
      url: "https://community.example/api/v1/contents/content/moderation",
      body: { label: "needs_review" },
    },
    {
      url: "https://community.example/api/v1/contents/content/audience",
      body: { label: "members_only" },
    },
    {
      url: "https://community.example/api/v1/contents/content/comments/new-comment",
      body: { body: "A write-only Comment response." },
    },
    {
      url: "https://community.example/api/v1/contents/content/comment-creations/receipt",
      body: { body: "A retry-safe Comment creation." },
    },
    {
      url: "https://community.example/api/v1/contents/content/comments/comment/moderation",
      body: { label: "hidden" },
    },
  ]);
});

test("BasstokClient keeps controlled Chat requests and attachments explicit", async () => {
  const observed: Array<{
    url: string;
    method: string;
    body: string;
    idempotencyKey: string | null;
  }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    observed.push({
      url: input.toString(),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "binary",
      idempotencyKey: headers.get("idempotency-key"),
    });
    if (input.toString().includes("/assets")) {
      return Response.json({
        id: "asset",
        name: "context.txt",
        media_type: "text/plain",
        size: 7,
        sha256: "0".repeat(64),
        integrity: { chunk_size: 16_777_216, chunk_sha256: [] },
      });
    }
    if (input.toString().includes("/messages")) {
      return Response.json({
        id: "message",
        body: "Hello",
        member_id: "persona",
        assets: [{ id: "asset" }],
      });
    }
    return Response.json({
      id: "chat",
      participants: [{ id: "responsible" }, { id: "persona" }],
      created_by_member_id: "responsible",
      assets: [],
      participant_members: [],
    });
  };
  const client = new BasstokClient("https://community.example", "token", fetchMock);

  const chatKey = "11111111-1111-4111-8111-111111111111";
  const assetKey = "22222222-2222-4222-8222-222222222222";
  const messageKey = "33333333-3333-4333-8333-333333333333";
  await client.createChat(chatKey, {
    participant_ids: ["persona", "peer"],
    creator_id: "persona",
  });
  await client.createSmallAsset(
    assetKey,
    { chat_id: "chat" },
    {
      name: "context.txt",
      media_type: "text/plain",
      bytes: new TextEncoder().encode("context"),
      actor_id: "persona",
    },
  );
  await client.sendMessage("chat", messageKey, {
    body: "Hello",
    author_id: "persona",
    asset_ids: ["asset"],
  });
  await client.addChatParticipant("chat", "later", "persona");
  await client.getMessages("chat", { actor_id: "later", order: "oldest" });

  assert.equal(observed[0]?.method, "POST");
  assert.equal(observed[0]?.url, "https://community.example/api/v1/chats");
  assert.equal(observed[0]?.idempotencyKey, chatKey);
  assert.deepEqual(JSON.parse(observed[0]?.body ?? ""), {
    participant_ids: ["persona", "peer"],
    creator_id: "persona",
  });
  assert.match(observed[1]?.url ?? "", /chat_id=chat/);
  assert.match(observed[1]?.url ?? "", /actor_id=persona/);
  assert.equal(observed[1]?.body, "binary");
  assert.equal(observed[1]?.method, "POST");
  assert.equal(observed[1]?.idempotencyKey, assetKey);
  assert.deepEqual(JSON.parse(observed[2]?.body ?? ""), {
    body: "Hello",
    author_id: "persona",
    asset_ids: ["asset"],
  });
  assert.equal(observed[2]?.method, "POST");
  assert.equal(observed[2]?.idempotencyKey, messageKey);
  assert.match(observed[3]?.url ?? "", /participants\/later\?actor_id=persona/);
  assert.equal(observed[3]?.method, "PUT");
  assert.match(observed[4]?.url ?? "", /actor_id=later/);
  assert.match(observed[4]?.url ?? "", /order=oldest/);
  assert.equal(observed[4]?.method, "GET");
});

test("BasstokClient accepts a late participant Chat without creation metadata", async () => {
  const client = new BasstokClient(
    "https://community.example",
    "token",
    async () => Response.json({
      id: "chat",
      participants: [{ id: "responsible" }, { id: "later" }],
      assets: [],
      participant_members: [],
    }),
  );

  const chat = await client.getChat("chat", "later");
  assert.equal(chat.created_by_member_id, undefined);
  assert.equal(chat.created_at, undefined);
  assert.equal(chat.attribution, undefined);
});

test("BasstokClient sends Member descriptions and bounded controlled discovery", async () => {
  const observed: string[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    observed.push(`${init?.method ?? "GET"} ${input}`);
    if ((init?.method ?? "GET") === "PUT") {
      return Response.json({
        id: "persona",
        display_name: "Avery",
        description: "Automated host",
        system_labels: [],
        attribution: "Created by Example Agent",
      });
    }
    return Response.json({ items: [], next_offset: 50 });
  };
  const client = new BasstokClient("https://community.example", "token", fetchMock);

  const member = await client.createMember("persona", {
    display_name: "Avery",
    description: "Automated host",
  });
  const controlled = await client.listControlledMembers(0, 25);
  await client.searchMembers("ave", 20, 50);

  assert.ok("description" in member);
  assert.equal(member.description, "Automated host");
  assert.equal(member.attribution, "Created by Example Agent");
  assert.equal(controlled.next_offset, 50);
  assert.deepEqual(observed, [
    "PUT https://community.example/api/v1/member-creations/persona",
    "GET https://community.example/api/v1/members/controlled?offset=0&limit=25",
    "GET https://community.example/api/v1/members/search?q=ave&limit=20&offset=50",
  ]);
});

test("BasstokClient keeps Comment reactions and subscriptions resource-scoped", async () => {
  const observed: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    observed.push({
      method: init?.method ?? "GET",
      url: input.toString(),
      ...(typeof init?.body === "string"
        ? { body: JSON.parse(init.body) as unknown }
        : {}),
    });
    if (input.toString().includes("/subscription")) {
      return Response.json({ subscribed: true, subscriber_count: 3 });
    }
    if (input.toString().includes("/reaction-summary")) {
      return Response.json({
        like_count: 0,
        love_count: 1,
        celebrate_count: 0,
        insightful_count: 0,
        total_count: 1,
      });
    }
    return init?.method === "PUT" || init?.method === "DELETE"
      ? new Response(null, { status: 204 })
      : Response.json({ items: [] });
  };
  const client = new BasstokClient("https://community.example", "token", fetchMock);

  await client.putReaction("content", "Love", {
    actor_id: "persona",
    comment_id: "comment",
  });
  await client.deleteReaction("content", {
    actor_id: "persona",
    comment_id: "comment",
  });
  await client.listReactions("content", { comment_id: "comment", limit: 25 });
  const summary = await client.getReactionSummary("content", "comment");
  const subscription = await client.getContentSubscription("content", "persona");

  assert.equal(summary.total_count, 1);
  assert.equal(summary.member_reaction, undefined);
  assert.equal(subscription.subscribed, true);
  assert.deepEqual(observed, [
    {
      method: "PUT",
      url: "https://community.example/api/v1/reaction?content_id=content&comment_id=comment&actor_id=persona",
      body: { kind: "Love" },
    },
    {
      method: "DELETE",
      url: "https://community.example/api/v1/reaction?content_id=content&comment_id=comment&actor_id=persona",
    },
    {
      method: "GET",
      url: "https://community.example/api/v1/reactions?content_id=content&comment_id=comment&limit=25",
    },
    {
      method: "GET",
      url: "https://community.example/api/v1/reaction-summary?content_id=content&comment_id=comment",
    },
    {
      method: "GET",
      url: "https://community.example/api/v1/contents/content/subscription?actor_id=persona",
    },
  ]);
});

test("BasstokClient reads authorized resources and Asset byte ranges", async () => {
  const observed: Array<{ method: string; url: string; range: string | null }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    observed.push({
      method: init?.method ?? "GET",
      url: input.toString(),
      range: headers.get("range"),
    });
    const url = input.toString();
    if (url.includes("/assets/")) {
      if (init?.method === "DELETE") return Response.json({ id: "chat" });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    if (url.endsWith("/members/member")) {
      return Response.json({
        id: "member",
        display_name: "Member",
        description: "Public profile text",
        system_labels: [],
      });
    }
    if (url.includes("/comments/comment")) {
      return Response.json({
        id: "comment",
        body: "Reply",
        system_labels: [],
        authorship: { member_id: "member", display_name: "Member" },
        assets: [],
      });
    }
    return Response.json({ items: [] });
  };
  const client = new BasstokClient("https://community.example", "token", fetchMock);

  await client.listContents({
    label_id: "selected",
    order: "newest",
    limit: 10,
  });
  await client.listComments("content", { order: "oldest", limit: 20 });
  const comment = await client.getComment("content", "comment");
  await client.listMembers(0, 25);
  const member = await client.getMember("member");
  const bytes = await client.getAssetBytes("asset", {
    actor_id: "persona",
    range: "bytes=0-2",
  });
  await client.detachChatAsset("chat", "asset", "persona");

  assert.equal(comment.authorship.display_name, "Member");
  assert.equal(member.description, "Public profile text");
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.deepEqual(observed, [
    {
      method: "GET",
      url: "https://community.example/api/v1/contents?label_id=selected&order=newest&limit=10",
      range: null,
    },
    {
      method: "GET",
      url: "https://community.example/api/v1/contents/content/comments?order=oldest&limit=20",
      range: null,
    },
    {
      method: "GET",
      url: "https://community.example/api/v1/contents/content/comments/comment",
      range: null,
    },
    {
      method: "GET",
      url: "https://community.example/api/v1/members?offset=0&limit=25",
      range: null,
    },
    {
      method: "GET",
      url: "https://community.example/api/v1/members/member",
      range: null,
    },
    {
      method: "GET",
      url: "https://community.example/api/v1/assets/asset?actor_id=persona",
      range: "bytes=0-2",
    },
    {
      method: "DELETE",
      url: "https://community.example/api/v1/chats/chat/assets/asset?actor_id=persona",
      range: null,
    },
  ]);
});

test("BasstokClient revokes only the named current application grant", async () => {
  let observedUrl = "";
  let observedMethod = "";
  let observedAuthorization = "";
  const fetchMock: typeof fetch = async (input, init) => {
    observedUrl = input.toString();
    observedMethod = init?.method ?? "GET";
    observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(null, { status: 204 });
  };
  const client = new BasstokClient("https://community.example", "agent-token", fetchMock);

  await client.revokeGrant("grant/one");

  assert.equal(
    observedUrl,
    "https://community.example/api/v1/application-grants/grant%2Fone",
  );
  assert.equal(observedMethod, "DELETE");
  assert.equal(observedAuthorization, "Bearer agent-token");
});

test("BasstokClient keeps webhook signing secrets write-only", async () => {
  const fetchMock: typeof fetch = async (input, init) => {
    if (init?.method === "PUT") {
      return Response.json({
        id: "hook",
        application_id: "application",
        grant_id: "grant",
        name: "Content changes",
        endpoint: "https://agent.example/webhooks/basstok",
        events: ["content.changed"],
        signing_secret: "new-secret",
        created_at: "2026-09-04T00:00:00Z",
        active: true,
      });
    }
    assert.equal(
      input.toString(),
      "https://community.example/api/v1/applications/application/webhooks" +
        "?offset=0&limit=25",
    );
    return Response.json({
      items: [{
        id: "hook",
        application_id: "application",
        grant_id: "grant",
        name: "Content changes",
        endpoint: "https://agent.example/webhooks/basstok",
        events: ["content.changed"],
        created_at: "2026-09-04T00:00:00Z",
        active: true,
      }],
    });
  };
  const client = new BasstokClient("https://community.example", "token", fetchMock);

  const created = await client.putWebhook("application", "hook", {
    grant_id: "grant",
    name: "Content changes",
    endpoint: "https://agent.example/webhooks/basstok",
    events: ["content.changed"],
  });
  const listed = await client.listWebhooks("application", 0, 25);

  assert.equal(created.signing_secret, "new-secret");
  assert.equal("signing_secret" in listed.items[0]!, false);
});
