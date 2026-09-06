import assert from "node:assert/strict";
import test from "node:test";

import { featureCommunityFavorite } from "../agents/community-favorites.js";
import { closeDiscussion } from "../agents/discussion-closeout.js";
import { acknowledgeHelpRequest } from "../agents/help-desk.js";
import { parsePollChoices, publishPollGuide } from "../agents/quick-polls.js";
import { welcomeMember } from "../agents/welcome-guide.js";
import {
  BasstokClient,
  type Content,
  type Member,
} from "../src/basstok.js";
import { deterministicId } from "../src/ids.js";

interface RequestRecord {
  method: string;
  url: string;
  body?: unknown;
  idempotencyKey?: string;
}

test("Welcome guide sends one retry-stable direct welcome and skips Agent Members", async () => {
  const requests: RequestRecord[] = [];
  const api = recordingClient(requests, (url, method) => {
    if (url.endsWith("/auth/session")) return Response.json({ member_id: "guide" });
    if (method === "POST" && new URL(url).pathname === "/api/v1/chats") {
      return Response.json({ id: "existing-direct-chat" });
    }
    if (method === "POST" && url.endsWith("/messages")) return messageResponse();
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await welcomeMember(member(), api);
  await welcomeMember(member(), api);

  const chatWrites = requests.filter(({ url }) =>
    new URL(url).pathname === "/api/v1/chats"
  );
  const messageWrites = requests.filter(({ url }) => url.endsWith("/messages"));
  assert.equal(chatWrites.length, 2);
  assert.equal(messageWrites.length, 2);
  assert.equal(chatWrites[0]?.url, chatWrites[1]?.url);
  assert.equal(messageWrites[0]?.url, messageWrites[1]?.url);
  assert.equal(chatWrites[0]?.url, "https://community.example/api/v1/chats");
  assert.equal(
    messageWrites[0]?.url,
    "https://community.example/api/v1/chats/existing-direct-chat/messages",
  );
  assert.match(chatWrites[0]?.idempotencyKey ?? "", uuidV4);
  assert.equal(chatWrites[0]?.idempotencyKey, chatWrites[1]?.idempotencyKey);
  assert.match(messageWrites[0]?.idempotencyKey ?? "", uuidV4);
  assert.equal(messageWrites[0]?.idempotencyKey, messageWrites[1]?.idempotencyKey);
  assert.deepEqual(chatWrites[0]?.body, { participant_ids: ["guide", "new-member"] });

  const skipped: RequestRecord[] = [];
  await welcomeMember(member({ attribution: "Created by another Agent" }),
    recordingClient(skipped, () => { throw new Error("must not fetch"); }));
  assert.deepEqual(skipped, []);
});

test("Help desk sends one retry-stable acknowledgment for labeled Content", async () => {
  const requests: RequestRecord[] = [];
  const api = recordingClient(requests, (url, method) => {
    if (url.endsWith("/auth/session")) return Response.json({ member_id: "helper" });
    if (method === "POST" && new URL(url).pathname === "/api/v1/chats") {
      return Response.json({ id: "direct-help-chat" });
    }
    if (method === "POST" && url.endsWith("/messages")) return messageResponse();
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await acknowledgeHelpRequest(content({
    id: "question",
    labels: [{ id: "help" }],
    authorship: { member_id: "asker", display_name: "Asker" },
  }), api, "help");
  await acknowledgeHelpRequest(content({
    id: "question",
    labels: [{ id: "help" }],
    authorship: { member_id: "asker", display_name: "Asker" },
  }), api, "help");

  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "POST", "POST", "GET", "POST", "POST"],
  );
  assert.deepEqual(requests[1]?.body, { participant_ids: ["helper", "asker"] });
  assert.equal(
    requests[2]?.url,
    "https://community.example/api/v1/chats/direct-help-chat/messages",
  );
  assert.match(requests[1]?.idempotencyKey ?? "", uuidV4);
  assert.match(requests[2]?.idempotencyKey ?? "", uuidV4);
  assert.equal(requests[1]?.url, requests[4]?.url);
  assert.equal(requests[2]?.url, requests[5]?.url);
  assert.deepEqual(requests[2]?.body, requests[5]?.body);
});

test("Help desk ignores unrelated, unauthored, and self-authored Content", async () => {
  const requests: RequestRecord[] = [];
  const api = recordingClient(requests, (url) => {
    if (url.endsWith("/auth/session")) return Response.json({ member_id: "helper" });
    throw new Error(`Unexpected request: ${url}`);
  });
  await acknowledgeHelpRequest(content(), api, "help");
  await acknowledgeHelpRequest(content({ labels: [{ id: "help" }], authorship: {} }), api, "help");
  await acknowledgeHelpRequest(content({
    labels: [{ id: "help" }],
    authorship: { member_id: "helper", display_name: "Helper" },
  }), api, "help");
  assert.equal(requests.length, 1);
  assert.ok(requests.every(({ url }) => url.endsWith("/auth/session")));
});

test("Help desk follows up after another Agent updates Member-authored Content", async () => {
  const requests: RequestRecord[] = [];
  const api = recordingClient(requests, (url, method) => {
    if (url.endsWith("/auth/session")) return Response.json({ member_id: "helper" });
    if (method === "POST" && new URL(url).pathname === "/api/v1/chats") {
      return Response.json({ id: "direct-help-chat" });
    }
    if (method === "POST" && url.endsWith("/messages")) return messageResponse();
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await acknowledgeHelpRequest(content({
    id: "updated-question",
    labels: [{ id: "help" }],
    authorship: { member_id: "asker", display_name: "Asker" },
    attribution: "Updated by another Agent",
  }), api, "help");

  assert.deepEqual(requests.map(({ method }) => method), ["GET", "POST", "POST"]);
});

test("Quick polls publish one deterministic reaction guide and then freeze it", async () => {
  const requests: RequestRecord[] = [];
  let guideExists = false;
  const api = recordingClient(requests, (url, method) => {
    if (method === "GET" && url.includes("/comments/")) {
      return guideExists ? commentResponse("Existing guide", "Quick polls") : notFound();
    }
    if (method === "PUT" && url.includes("/comment-creations/")) {
      guideExists = true;
      return commentResponse("Guide", "Quick polls");
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  const poll = content({
    id: "lunch-poll",
    body: "- Garden\n- Workshop\n- Library",
    labels: [{ id: "poll" }],
  });

  await publishPollGuide(poll, api, "poll");
  await publishPollGuide({ ...poll, body: "- Changed\n- Later" }, api, "poll");
  guideExists = false;
  await publishPollGuide(
    { ...poll, system_labels: ["replies_paused"] }, api, "poll",
  );

  const writes = requests.filter(({ method }) => method === "PUT");
  assert.equal(writes.length, 1);
  assert.match(writes[0]?.url ?? "", /\/comment-creations\//);
  assert.match(writes[0]?.url ?? "", uuidAtEnd);
  assert.deepEqual(writes[0]?.body, {
    body: "**Vote with a reaction:**\n\n" +
      "- 👍 — Garden\n- ❤️ — Workshop\n- 🎉 — Library",
  });
});

test("Quick polls do not trust a foreign Comment at their deterministic receipt", async () => {
  const requests: RequestRecord[] = [];
  const api = recordingClient(requests, (url, method) => {
    if (method === "GET" && url.includes("/comments/")) {
      return commentResponse("Not an Agent receipt", "Created by a Member");
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await publishPollGuide(content({
    id: "claimed-poll",
    body: "- One\n- Two",
    labels: [{ id: "poll" }],
  }), api, "poll");

  assert.deepEqual(requests.map(({ method }) => method), ["GET"]);
});

test("Quick polls accept only two to four bounded top-level unique choices", () => {
  assert.deepEqual(parsePollChoices("- One\n* Two\n+ Three\n- Four"), [
    "One", "Two", "Three", "Four",
  ]);
  assert.equal(parsePollChoices("- One"), undefined);
  assert.equal(parsePollChoices("- One\n- Two\n- Three\n- Four\n- Five"), undefined);
  assert.equal(parsePollChoices("  - Nested\n- One\n- Two"), undefined);
  assert.equal(parsePollChoices("Question\n- One\n- Two"), undefined);
  assert.equal(parsePollChoices("- Same\n- same"), undefined);
  assert.deepEqual(parsePollChoices("- Ä\n- ä"), ["Ä", "ä"]);
  assert.equal(parsePollChoices(`- ${"x".repeat(161)}\n- Two`), undefined);
  assert.equal(parsePollChoices(`- ${"x".repeat(2_048)}\n- Two`), undefined);
});

test("Discussion closeout ignores withheld Content", async () => {
  for (const systemLabel of ["hidden", "needs_review"] as const) {
    const requests: RequestRecord[] = [];
    await closeDiscussion(
      content({
        id: `withheld-${systemLabel}`,
        labels: [{ id: "closeout" }],
        system_labels: [systemLabel],
      }),
      recordingClient(requests, () => {
        throw new Error("withheld Content must not be dereferenced or mutated");
      }),
      "closeout",
    );
    assert.deepEqual(requests, []);
  }
});

test("Discussion closeout commits one bounded recap before pausing replies", async () => {
  const requests: RequestRecord[] = [];
  let recapBody: string | undefined;
  const expectedRecapId = recapId("topic");
  const api = recordingClient(requests, (url, method) => {
    if (method === "GET" && /\/comments\/[0-9a-f-]{36}$/.test(url)) {
      return recapBody === undefined
        ? notFound()
        : commentResponse(recapBody, "Discussion closeout", expectedRecapId);
    }
    if (method === "GET" && url.includes("/comments?")) {
      return Response.json({
        items: [
          ...Array.from({ length: 19 }, (_, index) =>
            comment(`alice-${index}`, "alice")),
          comment("twenty", "bob"),
          comment("hidden", "mallory", ["hidden"]),
          { ...comment("hidden-child", "mallory"), parent_id: "hidden" },
        ],
      });
    }
    if (method === "PUT" && /\/comment-creations\/[0-9a-f-]{36}$/.test(url)) {
      const request = requests.at(-1)?.body as { body: string };
      recapBody = request.body;
      return commentResponse(recapBody, "Discussion closeout", expectedRecapId);
    }
    if (method === "PUT" && url.endsWith("/replies")) return Response.json({ id: "topic" });
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  const closing = content({ id: "topic", labels: [{ id: "closeout" }] });

  await closeDiscussion(closing, api, "closeout");
  await closeDiscussion(closing, api, "closeout");
  await closeDiscussion(
    { ...closing, system_labels: ["replies_paused"] }, api, "closeout",
  );

  assert.deepEqual(requests.map(({ method, url }) =>
    `${method} ${new URL(url).pathname}${new URL(url).search}`), [
    `GET /api/v1/contents/topic/comments/${recapId("topic")}`,
    "GET /api/v1/contents/topic/comments?offset=0&limit=100&order=oldest",
    `PUT /api/v1/contents/topic/comment-creations/${recapId("topic")}`,
    "PUT /api/v1/contents/topic/replies",
    `GET /api/v1/contents/topic/comments/${recapId("topic")}`,
    `PUT /api/v1/contents/topic/comment-creations/${recapId("topic")}`,
    "PUT /api/v1/contents/topic/replies",
  ]);
  assert.deepEqual(requests[2]?.body, {
    body: "**Discussion closeout**\n\nThis discussion reached " +
      "20 visible comments from 2 participants.",
  });
});

test("Discussion closeout carries suppression across pages without hiding children of unobserved parents", async () => {
  const requests: RequestRecord[] = [];
  const closing = content({
    id: "long-closeout",
    labels: [{ id: "closeout" }],
  });
  const expectedRecapId = recapId(closing.id);
  const api = recordingClient(requests, (url, method, body) => {
    if (method === "GET" && url.endsWith(`/comments/${expectedRecapId}`)) {
      return notFound();
    }
    if (method === "GET" && url.includes("/comments?")) {
      const offset = Number(new URL(url).searchParams.get("offset"));
      if (offset === 0) {
        return Response.json({
          items: Array.from({ length: 100 }, (_, index) =>
            comment(`hidden-${index}`, "withheld", ["hidden"])),
          next_offset: 137,
        });
      }
      if (offset === 137) {
        return Response.json({
          items: [
            comment("hidden-100", "withheld", ["needs_review"]),
            { ...comment("hidden-child", "withheld"), parent_id: "hidden-0" },
            ...Array.from({ length: 10 }, (_, index) =>
              comment(`visible-a-${index}`, "alice")),
          ],
          next_offset: 901,
        });
      }
      if (offset === 901) {
        return Response.json({
          items: [
            { ...comment("visible-child", "bob"), parent_id: "visible-a-9" },
            { ...comment("blocked-parent-child", "bob"), parent_id: "blocked-parent" },
            { ...comment("missing-parent-child", "alice"), parent_id: "missing-parent" },
            ...Array.from({ length: 7 }, (_, index) =>
              comment(`visible-b-${index}`, "alice")),
          ],
        });
      }
    }
    if (method === "PUT" &&
        url.endsWith(`/comment-creations/${expectedRecapId}`)) {
      return commentResponse(
        (body as { body: string }).body,
        "Discussion closeout",
        expectedRecapId,
      );
    }
    if (method === "PUT" && url.endsWith("/replies")) {
      return Response.json({ id: closing.id });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await closeDiscussion(closing, api, "closeout");

  assert.deepEqual(
    requests.filter(({ method, url }) =>
      method === "GET" && url.includes("/comments?")
    ).map(({ url }) => Number(new URL(url).searchParams.get("offset"))),
    [0, 137, 901],
  );
  assert.deepEqual(
    requests.find(({ method, url }) =>
      method === "PUT" && url.includes("/comment-creations/")
    )?.body,
    {
      body: "**Discussion closeout**\n\nThis discussion reached " +
        "20 visible comments from 2 participants.",
    },
  );
  assert.ok(requests.some(({ method, url }) =>
    method === "PUT" && url.endsWith("/replies")));
});

test("Discussion closeout rejects non-progressing or out-of-bound pagination", async () => {
  for (const nextOffset of [0, 100_001]) {
    const requests: RequestRecord[] = [];
    const closing = content({
      id: `invalid-page-${nextOffset}`,
      labels: [{ id: "closeout" }],
    });
    const api = recordingClient(requests, (url, method) => {
      if (method === "GET" && url.includes("/comments/") &&
          !url.includes("/comments?")) return notFound();
      if (method === "GET" && url.includes("/comments?")) {
        return Response.json({ items: [], next_offset: nextOffset });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await assert.rejects(
      closeDiscussion(closing, api, "closeout"),
      /Comment pagination/,
    );
    assert.ok(requests.every(({ method }) => method === "GET"));
  }
});

test("Discussion closeout recovers after its recap commit response is lost", async () => {
  const requests: RequestRecord[] = [];
  const closing = content({
    id: "ambiguous-closeout",
    labels: [{ id: "closeout" }],
  });
  const expectedRecapId = recapId(closing.id);
  let committedBody: string | undefined;
  let laterCommentExists = false;
  let recapWrites = 0;
  let pauses = 0;
  const api = recordingClient(requests, (url, method, body) => {
    if (method === "GET" && url.includes("/comments?")) {
      return Response.json({
        items: [
          ...Array.from({ length: 20 }, (_, index) =>
            comment(`visible-${index}`, "member")),
          ...(laterCommentExists ? [comment("visible-later", "later-member")] : []),
          ...(committedBody === undefined ? [] : [{
            ...comment(expectedRecapId, "manager"),
            body: committedBody,
            attribution: "Discussion closeout",
          }]),
        ],
      });
    }
    if (method === "GET" && url.endsWith(`/comments/${expectedRecapId}`)) {
      return committedBody === undefined
        ? notFound()
        : commentResponse(committedBody, "Discussion closeout", expectedRecapId);
    }
    if (method === "PUT" && url.endsWith(`/comment-creations/${expectedRecapId}`)) {
      recapWrites += 1;
      const requested = body as { body: string };
      if (committedBody === undefined) {
        committedBody = requested.body;
        throw new Error("connection ended after the recap committed");
      }
      assert.equal(requested.body, committedBody);
      return commentResponse(committedBody, "Discussion closeout", expectedRecapId);
    }
    if (method === "PUT" && url.endsWith("/replies")) {
      pauses += 1;
      return Response.json({ id: closing.id });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await assert.rejects(
    closeDiscussion(closing, api, "closeout"),
    /connection ended after the recap committed/,
  );
  laterCommentExists = true;
  await closeDiscussion(closing, api, "closeout");

  assert.equal(recapWrites, 2);
  assert.equal(pauses, 1);
  assert.equal(
    requests.filter(({ method, url }) =>
      method === "GET" && url.includes("/comments?")
    ).length,
    1,
  );
  assert.deepEqual(
    requests.filter(({ method, url }) =>
      method === "PUT" && url.endsWith(`/comment-creations/${expectedRecapId}`)
    ).map(({ body }) => body),
    [
      {
        body: "**Discussion closeout**\n\nThis discussion reached " +
          "20 visible comments from 1 participant.",
      },
      {
        body: "**Discussion closeout**\n\nThis discussion reached " +
          "20 visible comments from 1 participant.",
      },
    ],
  );
});

test("Discussion closeout leaves an opted-in discussion open below 20 visible Comments", async () => {
  const requests: RequestRecord[] = [];
  const api = recordingClient(requests, (url, method) => {
    if (method === "GET" && url.includes("/comments/") &&
        !url.includes("/comments?")) return notFound();
    if (method === "GET" && url.includes("/comments?")) {
      return Response.json({
        items: [
          ...Array.from({ length: 19 }, (_, index) =>
            comment(`visible-${index}`, "member")),
          comment(recapId("still-open"), "manager"),
          comment("withheld", "member", ["needs_review"]),
          { ...comment("withheld-child", "member"), parent_id: "withheld" },
        ],
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await closeDiscussion(
    content({ id: "still-open", labels: [{ id: "closeout" }] }),
    api,
    "closeout",
  );

  assert.deepEqual(requests.map(({ method }) => method), ["GET", "GET"]);
});

test("Discussion closeout keeps its receipt stable across responsible Member turnover", async () => {
  const receiptFor = async (responsibleMemberId: string): Promise<string> => {
    const requests: RequestRecord[] = [];
    const api = recordingClient(requests, (url, method) => {
      if (url.endsWith("/auth/session")) {
        return Response.json({ member_id: responsibleMemberId });
      }
      if (method === "GET" && url.includes("/comments?")) {
        return Response.json({
          items: Array.from({ length: 20 }, (_, index) =>
            comment(`visible-${index}`, "member")),
        });
      }
      if (method === "GET" && url.includes("/comments/")) return notFound();
      if (method === "PUT" && url.includes("/comment-creations/")) {
        const id = url.slice(url.lastIndexOf("/") + 1);
        return commentResponse(
          "**Discussion closeout**\n\nThis discussion reached " +
            "20 visible comments from 1 participant.",
          "Discussion closeout",
          id,
        );
      }
      if (method === "PUT" && url.endsWith("/replies")) {
        return Response.json({ id: "shared-content" });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    await closeDiscussion(
      content({ id: "shared-content", labels: [{ id: "closeout" }] }),
      api,
      "closeout",
    );
    return requests.find(({ method, url }) =>
      method === "GET" && url.includes("/comments/"))!.url;
  };

  assert.equal(await receiptFor("manager-a"), await receiptFor("manager-b"));
});

test("Discussion closeout leaves a foreign deterministic receipt untouched", async () => {
  const requests: RequestRecord[] = [];
  const expectedRecapId = recapId("claimed-closeout");
  const api = recordingClient(requests, (url, method) => {
    if (method === "GET" && url.includes("/comments?")) {
      return Response.json({
        items: Array.from({ length: 20 }, (_, index) =>
          comment(`visible-${index}`, "member")),
      });
    }
    if (method === "GET" && url.includes("/comments/")) {
      return commentResponse(
        "Not this Agent's receipt",
        "Discussion closeout",
        expectedRecapId,
      );
    }
    if (method === "PUT" && url.includes("/comment-creations/")) return conflict();
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await closeDiscussion(
    content({ id: "claimed-closeout", labels: [{ id: "closeout" }] }),
    api,
    "closeout",
  );

  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "PUT"],
  );
  assert.ok(requests.every(({ url }) => !url.endsWith("/replies")));
});

test("Discussion closeout pauses only after an exact unedited create response", async () => {
  const cases = [
    {
      name: "wrong-id",
      response: (id: string, body: string) =>
        Response.json({
          ...comment(deterministicId("foreign-closeout-response", id), "guide"),
          body,
        }),
    },
    {
      name: "wrong-body",
      response: (id: string, _body: string) =>
        Response.json({ ...comment(id, "guide"), body: "Different recap" }),
    },
    {
      name: "edited",
      response: (id: string, body: string) => Response.json({
        ...comment(id, "guide"),
        body,
        updated_at: "2026-09-04T12:00:00Z",
      }),
    },
  ];

  for (const { name, response } of cases) {
    const requests: RequestRecord[] = [];
    const contentId = `invalid-create-${name}`;
    const expectedRecapId = recapId(contentId);
    const api = recordingClient(requests, (url, method, body) => {
      if (method === "GET" && url.endsWith(`/comments/${expectedRecapId}`)) {
        return notFound();
      }
      if (method === "GET" && url.includes("/comments?")) {
        return Response.json({
          items: Array.from({ length: 20 }, (_, index) =>
            comment(`visible-${index}`, "member")),
        });
      }
      if (method === "PUT" &&
          url.endsWith(`/comment-creations/${expectedRecapId}`)) {
        return response(expectedRecapId, (body as { body: string }).body);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await closeDiscussion(
      content({ id: contentId, labels: [{ id: "closeout" }] }),
      api,
      "closeout",
    );

    assert.ok(requests.every(({ url }) => !url.endsWith("/replies")), name);
  }
});

test("Discussion closeout recovers an unedited recap under a renamed application", async () => {
  const requests: RequestRecord[] = [];
  const expectedRecapId = recapId("renamed-closeout");
  const api = recordingClient(requests, (url, method) => {
    if (method === "GET" && url.includes("/comments?")) {
      return Response.json({
        items: Array.from({ length: 20 }, (_, index) =>
          comment(`visible-${index}`, "member")),
      });
    }
    if (method === "GET" && url.includes("/comments/")) {
      return commentResponse(
        "**Discussion closeout**\n\nThis discussion reached " +
          "20 visible comments from 1 participant.",
        "Community wrap-up",
        expectedRecapId,
      );
    }
    if (method === "PUT" && url.includes("/comment-creations/")) {
      return commentResponse(
        "**Discussion closeout**\n\nThis discussion reached " +
          "20 visible comments from 1 participant.",
        "Community wrap-up",
        expectedRecapId,
      );
    }
    if (method === "PUT" && url.endsWith("/replies")) {
      return Response.json({ id: "renamed-closeout" });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await closeDiscussion(
    content({ id: "renamed-closeout", labels: [{ id: "closeout" }] }),
    api,
    "closeout",
  );

  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "PUT", "PUT"],
  );
});

test("Discussion closeout leaves an edited deterministic Comment untouched", async () => {
  const requests: RequestRecord[] = [];
  const expectedRecapId = recapId("edited-closeout");
  const api = recordingClient(requests, (url, method) => {
    if (method === "GET" && url.includes("/comments?")) {
      return Response.json({
        items: Array.from({ length: 20 }, (_, index) =>
          comment(`visible-${index}`, "member")),
      });
    }
    if (method === "GET" && url.includes("/comments/")) {
      return Response.json({
        ...comment(expectedRecapId, "guide"),
        body: "A Member edited this Comment.",
        updated_at: "2026-09-04T12:00:00Z",
        attribution: "Discussion closeout",
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await closeDiscussion(
    content({ id: "edited-closeout", labels: [{ id: "closeout" }] }),
    api,
    "closeout",
  );

  assert.deepEqual(requests.map(({ method }) => method), ["GET"]);
});

test("Community favorites features selected Content at five reactions and never unfeatures", async () => {
  const requests: RequestRecord[] = [];
  const api = recordingClient(requests, (url, method) => {
    if (url.includes("reaction-summary")) return Response.json(reactionSummary(5));
    if (method === "PUT" && url.endsWith("/featured")) return Response.json({ id: "favorite" });
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  await featureCommunityFavorite(content({
    id: "favorite",
    labels: [{ id: "favorites" }],
  }), api, "favorites");
  await featureCommunityFavorite(content({
    id: "favorite",
    labels: [{ id: "favorites" }],
    system_labels: ["featured"],
  }), api, "favorites");

  assert.deepEqual(requests.map(({ method, body }) => ({ method, body })), [
    { method: "GET", body: undefined },
    { method: "PUT", body: { featured: true } },
  ]);
});

function recordingClient(
  requests: RequestRecord[],
  respond: (url: string, method: string, body: unknown) => Response,
): BasstokClient {
  return new BasstokClient("https://community.example", "agent-token", async (input, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    const headers = new Headers(init?.headers);
    const record: RequestRecord = { method, url: input.toString() };
    if (body !== undefined) record.body = body;
    const key = headers.get("idempotency-key");
    if (key !== null) record.idempotencyKey = key;
    requests.push(record);
    return respond(input.toString(), method, body);
  });
}

function content(overrides: Partial<Content> = {}): Content {
  return {
    id: "content",
    title: "A discussion",
    body: "Body",
    labels: [],
    system_labels: [],
    authorship: { member_id: "author", display_name: "Author" },
    engagement: { views: 0 },
    assets: [],
    ...overrides,
  };
}

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: "new-member",
    display_name: "New Member",
    system_labels: [],
    ...overrides,
  };
}

function comment(id: string, memberId: string, systemLabels: string[] = []) {
  return {
    id,
    body: "Comment",
    system_labels: systemLabels,
    authorship: { member_id: memberId, display_name: memberId },
    assets: [],
  };
}

function commentResponse(
  body: string,
  attribution?: string,
  id = "comment",
): Response {
  return Response.json({ ...comment(id, "guide"), body, attribution });
}

function messageResponse(): Response {
  return Response.json({
    id: "message",
    body: "Message",
    member_id: "guide",
    assets: [],
  });
}

function reactionSummary(total: number) {
  return {
    like_count: total,
    love_count: 0,
    celebrate_count: 0,
    insightful_count: 0,
    total_count: total,
  };
}

function notFound(): Response {
  return Response.json({
    error: { code: "not_found", message: "Not found", retryable: false },
  }, { status: 404 });
}

function conflict(): Response {
  return Response.json({
    error: { code: "resource_conflict", message: "Conflict", retryable: false },
  }, { status: 409 });
}

function recapId(contentId: string): string {
  return deterministicId("discussion-closeout/recap", contentId);
}

const uuidAtEnd = /\/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
