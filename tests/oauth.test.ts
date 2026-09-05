import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  agentScopes,
  authorizeWithLoopback,
  authorizationUrl,
  completeGrantSetup,
  createPkce,
  exchangeAuthorizationCode,
  isAgentScope,
  parseAgentScopes,
  refreshAccessToken,
  revokeToken,
  validateOAuthTokens,
} from "../src/oauth.js";

test("failed Agent setup revokes the new OAuth grant", async () => {
  const setupFailure = new Error("credential commit failed");
  let revocations = 0;
  await assert.rejects(
    completeGrantSetup(
      async () => { throw setupFailure; },
      async () => { revocations += 1; },
    ),
    (error) => error === setupFailure,
  );
  assert.equal(revocations, 1);
});

test("failed Agent setup reports an unconfirmed grant revocation", async () => {
  const setupFailure = new Error("webhook setup failed");
  const revocationFailure = new Error("revocation response was lost");
  await assert.rejects(
    completeGrantSetup(
      async () => { throw setupFailure; },
      async () => { throw revocationFailure; },
    ),
    (error) => error instanceof AggregateError &&
      error.errors[0] === setupFailure && error.errors[1] === revocationFailure,
  );
});

test("PKCE and authorization URL use S256", () => {
  const pkce = createPkce();
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(authorizationUrl("https://community.example", {
    clientId: "sample-agent",
    redirectUri: "https://agent.example/callback",
    scopes: ["content:read", "moderation:write"],
    state: "random-state",
    challenge: pkce.challenge,
  }));
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "content:read moderation:write");
});

test("callback rejects wrong methods, hosts and duplicate fields before accepting consent", async () => {
  const port = await availablePort();
  let responses: Promise<void> | undefined;
  let exchanges = 0;
  await authorizeWithLoopback("https://community.example", {
    clientId: "agent", scopes: ["content:read"], port,
    onReady: (url, redirect) => {
      responses = (async () => {
        const callback = `${redirect}?state=${new URL(url).searchParams.get("state")}` +
          `&code=fixture-code&iss=${encodeURIComponent("https://community.example")}`;
        assert.equal((await fetch(callback, { method: "POST" })).status, 400);
        const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
          const request = httpRequest(callback, { headers: { Host: "agent.example" } }, (response) => {
            response.resume();
            resolve(response.statusCode);
          });
          request.on("error", reject);
          request.end();
        });
        assert.equal(wrongHost, 400);
        assert.equal((await fetch(callback + "&code=other")).status, 400);
        assert.equal(exchanges, 0);
        const accepted = await fetch(callback);
        assert.equal(accepted.status, 200);
        assert.equal(accepted.headers.get("cache-control"), "no-store");
      })();
    },
  }, async (_url, init) => {
    ++exchanges;
    assert.equal(init?.redirect, "error");
    return Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh",
      expires_in: 3600, scope: "content:read", grant_id: "grant", token_type: "Bearer" });
  });
  await responses;
  assert.equal(exchanges, 1);
});

test("callback setup errors and timeouts release the local listener", async () => {
  const port = await availablePort();
  await assert.rejects(authorizeWithLoopback("https://community.example", {
    clientId: "agent", scopes: ["content:read"], port,
    onReady: () => { throw new Error("Could not present authorization"); },
  }), /Could not present/);
  await assert.rejects(authorizeWithLoopback("https://community.example", {
    clientId: "agent", scopes: ["content:read"], port, timeoutMs: 20,
    onReady: () => {},
  }), /timed out/);
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("authorization code exchange uses form encoding", async () => {
  let observed = "";
  let signal: AbortSignal | null | undefined;
  const fetchMock: typeof fetch = async (_input, init) => {
    observed = String(init?.body);
    signal = init?.signal;
    return new Response(JSON.stringify({
      access_token: "access",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "refresh",
      scope: "content:read",
      grant_id: "grant",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const tokens = await exchangeAuthorizationCode("https://community.example", {
    clientId: "sample-agent",
    code: "code",
    redirectUri: "https://agent.example/callback",
    verifier: "v".repeat(43),
  }, fetchMock);
  assert.equal(new URLSearchParams(observed).get("code_verifier"), "v".repeat(43));
  assert.equal(tokens.grant_id, "grant");
  assert.ok(signal instanceof AbortSignal);
});

test("OAuth endpoints reject non-loopback cleartext origins", async () => {
  assert.throws(() => authorizationUrl("http://community.example", {
    clientId: "sample-agent",
    redirectUri: "https://agent.example/callback",
    scopes: ["content:read"],
    state: "state",
    challenge: "c".repeat(43),
  }), /HTTPS/);
  await assert.rejects(
    refreshAccessToken("http://community.example", "sample-agent", "refresh"),
    /HTTPS/,
  );
});

test("authorization URL supports the complete closed Agent scope vocabulary", () => {
  const url = new URL(authorizationUrl("https://community.example", {
    clientId: "community-agent",
    redirectUri: "https://agent.example/callback",
    scopes: [...agentScopes],
    state: "state",
    challenge: "c".repeat(43),
  }));
  assert.equal(url.searchParams.get("scope"), agentScopes.join(" "));
  assert.equal(isAgentScope("chat:read"), true);
  assert.equal(isAgentScope("tenant:admin"), false);
  assert.deepEqual(parseAgentScopes(undefined, ["content:read"]), ["content:read"]);
  assert.deepEqual(
    parseAgentScopes("member:read chat:read", []),
    ["member:read", "chat:read"],
  );
  assert.throws(() => parseAgentScopes("tenant:admin", []));
  assert.throws(() => parseAgentScopes("content:read content:read", []));
});

test("loopback authorization validates the callback and exchanges its code", async () => {
  const port = await availablePort();
  let callbackResponse: Promise<Response> | undefined;
  const tokens = await authorizeWithLoopback(
    "https://community.example",
    {
      clientId: "sample-agent",
      scopes: ["content:read"],
      port,
      onReady: (url, redirectUri) => {
        const state = new URL(url).searchParams.get("state");
        callbackResponse = fetch(
          `${redirectUri}?code=authorization-code&state=${state}` +
            `&iss=${encodeURIComponent("https://community.example")}`,
        );
      },
    },
    async (input, init) => {
      assert.equal(input.toString(), "https://community.example/oauth/token");
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("code"), "authorization-code");
      assert.match(form.get("code_verifier") ?? "", /^[A-Za-z0-9_-]{43,128}$/);
      return Response.json({
        access_token: "access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh",
        scope: "content:read",
        grant_id: "grant",
      });
    },
  );

  assert.equal(tokens.grant_id, "grant");
  assert.equal((await callbackResponse)?.status, 200);
});

test("loopback authorization requires the Basstok issuer", async () => {
  const port = await availablePort();
  let callbackResponse: Promise<Response> | undefined;
  await assert.rejects(authorizeWithLoopback(
    "https://community.example",
    {
      clientId: "sample-agent",
      scopes: ["content:read"],
      port,
      onReady: (url, redirectUri) => {
        const state = new URL(url).searchParams.get("state");
        callbackResponse = fetch(`${redirectUri}?code=authorization-code&state=${state}`);
      },
    },
    async () => {
      throw new Error("token exchange must not run");
    },
  ), /issuer/);
  assert.equal((await callbackResponse)?.status, 500);
});

test("loopback authorization requires an exact issuer origin", async () => {
  const port = await availablePort();
  let callbackResponse: Promise<Response> | undefined;
  await assert.rejects(authorizeWithLoopback(
    "https://community.example",
    {
      clientId: "sample-agent",
      scopes: ["content:read"],
      port,
      onReady: (url, redirectUri) => {
        const state = new URL(url).searchParams.get("state");
        callbackResponse = fetch(
          `${redirectUri}?code=authorization-code&state=${state}` +
            `&iss=${encodeURIComponent("https://community.example/not-the-issuer")}`,
        );
      },
    },
    async () => {
      throw new Error("token exchange must not run");
    },
  ), /issuer/);
  assert.equal((await callbackResponse)?.status, 500);
});

test("a malformed duplicate callback cannot interrupt an accepted exchange", async () => {
  const port = await availablePort();
  let callbackResponses: Promise<[Response, Response]> | undefined;
  let releaseExchange: (() => void) | undefined;
  const exchangeStarted = Promise.withResolvers<void>();
  const exchangeRelease = new Promise<void>((resolve) => {
    releaseExchange = resolve;
  });
  let exchanges = 0;

  const tokens = await authorizeWithLoopback(
    "https://community.example",
    {
      clientId: "sample-agent",
      scopes: ["content:read"],
      port,
      onReady: (url, redirectUri) => {
        const state = new URL(url).searchParams.get("state");
        const callback = `${redirectUri}?code=authorization-code&state=${state}` +
          `&iss=${encodeURIComponent("https://community.example")}`;
        callbackResponses = (async () => {
          const accepted = fetch(callback);
          await exchangeStarted.promise;
          const duplicate = await fetch(
            `${redirectUri}?error=access_denied&state=${state}`,
          );
          releaseExchange?.();
          return [await accepted, duplicate];
        })();
      },
    },
    async () => {
      exchanges += 1;
      exchangeStarted.resolve();
      await exchangeRelease;
      return Response.json({
        access_token: "access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh",
        scope: "content:read",
        grant_id: "grant",
      });
    },
  );

  assert.equal(tokens.grant_id, "grant");
  const [accepted, duplicate] = await callbackResponses!;
  assert.equal(accepted.status, 200);
  assert.equal(duplicate.status, 409);
  assert.equal(exchanges, 1);
});

test("refresh and revocation use their public form contracts", async () => {
  const observed: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    observed.push({
      url: input.toString(),
      body: new URLSearchParams(String(init?.body)),
    });
    if (input.toString().endsWith("/oauth/revoke")) {
      return new Response(null, { status: 200 });
    }
    return Response.json({
      access_token: "next-access",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "next-refresh",
      scope: "chat:read",
      grant_id: "grant",
    });
  };

  const tokens = await refreshAccessToken(
    "https://community.example",
    "example-agent",
    "current-refresh",
    fetchMock,
  );
  await revokeToken(
    "https://community.example",
    tokens.refresh_token,
    "example-agent",
    fetchMock,
  );

  assert.equal(tokens.access_token, "next-access");
  assert.deepEqual(
    [...(observed[0]?.body ?? new URLSearchParams())],
    [
      ["grant_type", "refresh_token"],
      ["client_id", "example-agent"],
      ["refresh_token", "current-refresh"],
    ],
  );
  assert.deepEqual(
    [...(observed[1]?.body ?? new URLSearchParams())],
    [
      ["token", "next-refresh"],
      ["client_id", "example-agent"],
    ],
  );
});

test("OAuth token responses are strictly bounded", () => {
  assert.throws(() => validateOAuthTokens({
    access_token: "access",
    token_type: "bearer",
    expires_in: 3_600,
    refresh_token: "refresh",
    scope: "content:read",
    grant_id: "grant",
  }), /invalid/);
  assert.throws(() => validateOAuthTokens({
    access_token: "a".repeat(8_193),
    token_type: "Bearer",
    expires_in: 3_600,
    refresh_token: "refresh",
    scope: "content:read",
    grant_id: "grant",
  }), /invalid/);
  assert.doesNotThrow(() => validateOAuthTokens({
    access_token: "access",
    token_type: "Bearer",
    expires_in: 0,
    refresh_token: "refresh",
    scope: "content:read",
    grant_id: "grant",
  }));
  assert.throws(() => validateOAuthTokens({
    access_token: "access",
    token_type: "Bearer",
    expires_in: 3_601,
    refresh_token: "refresh",
    scope: "content:read",
    grant_id: "grant",
  }), /invalid/);
});

test("OAuth token exchange rejects an oversized response before parsing", async () => {
  await assert.rejects(
    exchangeAuthorizationCode("https://community.example", {
      clientId: "sample-agent",
      code: "code",
      redirectUri: "https://agent.example/callback",
      verifier: "v".repeat(43),
    }, async () => new Response("x".repeat(64 * 1024 + 1))),
    /too large/,
  );
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
  return port;
}
