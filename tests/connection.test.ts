import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { connectAgent, readConnection, validateConnection, type AgentConnection } from "../src/connection.js";
import { RotatingCredentials } from "../src/credentials.js";
import { serveAgent } from "../src/webhooks.js";

const connection: AgentConnection = {
  version: 1, origin: "https://community.example", clientId: "favorites",
  name: "Community favorites", scopes: ["content:read", "moderation:write"],
  event: "content.changed", webhookUrl: "https://agent.example/webhooks/basstok",
  callbackPort: 3001, port: 3000,
};

test("connections reject unknown fields, unsafe destinations, scopes and ports", () => {
  assert.deepEqual(validateConnection(connection), connection);
  for (const change of [
    { extra: true }, { version: 2 }, { origin: "http://community.example" },
    { origin: "https://community.example/other" }, { name: "x\nheader" },
    { webhookUrl: "https://secret@agent.example/webhooks/basstok" },
    { webhookUrl: "https://agent.example/webhooks/basstok?secret=never" },
    { webhookUrl: "http://agent.example/webhooks/basstok" },
    { webhookUrl: "https://agent.example/wrong" }, { scopes: ["chat:read"] },
    { scopes: ["content:read", "content:read"] }, { scopes: ["full:access"] },
    { event: "toString" }, { callbackPort: 0 }, { port: 65_536 }, { port: 3001 },
  ]) assert.throws(() => validateConnection({ ...connection, ...change }));
});

test("connect and serve run OAuth, registration, rotation and signed delivery through HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basstok-connect-"));
  const path = join(directory, ".basstok-agent.json");
  const callbackPort = await availablePort();
  const webhookPort = await availablePort();
  let origin = "";
  let challenge = "";
  let registrations = 0;
  let refreshes = 0;
  let reads = 0;
  let mutations = 0;
  let revoked = false;
  let observedAuthorization = "";
  const failures: unknown[] = [];
  const api = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      const respond = (value: unknown, status = 200): void => {
        response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
      };
      if (request.url === "/oauth/token") {
        const form = new URLSearchParams(text);
        const refreshing = form.get("grant_type") === "refresh_token";
        if (refreshing) {
          assert.equal(form.get("refresh_token"), "fixture-refresh-once");
          ++refreshes;
        } else {
          assert.equal(form.get("code"), "fixture-code");
          assert.equal(createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url"), challenge);
          assert.equal(form.get("redirect_uri"), `http://127.0.0.1:${callbackPort}/callback`);
        }
        respond({
          access_token: refreshing ? "fixture-access-rotated" : "fixture-access",
          refresh_token: refreshing ? "fixture-refresh-next" : "fixture-refresh-once",
          token_type: "Bearer", expires_in: refreshing ? 3600 : 0,
          scope: connection.scopes.join(" "), grant_id: "fixture-grant",
        });
      } else if (request.url === "/api/v1/applications/favorites/webhooks/favorites") {
        assert.equal(request.method, "PUT");
        assert.equal(request.headers.authorization, "Bearer fixture-access");
        assert.deepEqual(JSON.parse(text), {
          grant_id: "fixture-grant", name: connection.name,
          endpoint: connection.webhookUrl, events: [connection.event],
        });
        ++registrations;
        respond({ signing_secret: "fixture-webhook-secret" });
      } else if (request.url === "/api/v1/contents/one") {
        ++reads;
        observedAuthorization = request.headers.authorization ?? "";
        if (revoked) respond({ error: { code: "forbidden", message: "Forbidden", retryable: false } }, 403);
        else respond({ id: "one", labels: [], system_labels: [] });
      } else if (request.url === "/api/v1/contents/one/featured") {
        assert.equal(request.method, "PUT");
        ++mutations;
        respond({ id: "one" });
      } else throw new Error(`Unexpected fixture route ${request.url}`);
    } catch (error) {
      failures.push(error);
      response.writeHead(500).end();
    }
  });
  let receiver: Server | undefined;
  try {
    origin = await listen(api);
    const config = { ...connection, origin, callbackPort, port: webhookPort };
    let callback: Promise<Response> | undefined;
    let output = "";
    const cli = spawn(process.execPath, [
      "dist/src/cli.js", "connect", origin, "--agent", "community-favorites",
      "--client-id", "favorites", "--webhook-url", connection.webhookUrl,
      "--callback-port", String(callbackPort), "--port", String(webhookPort),
    ], { env: { ...process.env, BASSTOK_CONNECTION_FILE: path }, timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"] });
    cli.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+\/oauth\/authorize\?[^\s]+/);
      if (url !== null && callback === undefined) {
        const authorization = new URL(url[0]);
        challenge = authorization.searchParams.get("code_challenge") ?? "";
        callback = fetch(`${authorization.searchParams.get("redirect_uri")}` +
          `?state=${authorization.searchParams.get("state")}&code=fixture-code&iss=${encodeURIComponent(origin)}`);
      }
    });
    cli.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const exit = await new Promise((resolve) => cli.once("exit", resolve));
    assert.equal(exit, 0, output);
    assert.equal((await callback)?.status, 200);
    assert.doesNotMatch(output, /fixture-access|fixture-refresh|fixture-webhook-secret/);
    assert.deepEqual(await readConnection(path), config);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(`${path}.credentials`)).mode & 0o777, 0o600);
    assert.equal(registrations, 1);

    const handlers = { name: connection.name, onContentChanged: async (content: { id: string }, basstok: import("../src/basstok.js").BasstokClient) => {
      await basstok.setFeatured(content.id, true);
    } };
    receiver = await serveAgent(handlers, { connectionFile: path });
    await assert.rejects(connectAgent(config, { path, onReady: () => assert.fail("Already running") }), /in use|owned|running/i);
    const send = async (id: string, secret = "fixture-webhook-secret"): Promise<Response> => {
      const occurred = "2026-01-01T00:00:00Z";
      const body = JSON.stringify({ id, occurred_at: occurred, organization_id: "community",
        event: "content.changed", resource: { type: "Content", id: "one" } });
      const signature = createHmac("sha256", secret).update(`v1\n${id}\n${occurred}\n${body}`).digest("hex");
      return fetch(`http://127.0.0.1:${webhookPort}/webhooks/basstok`, {
        method: "POST", headers: {
          "Basstok-Webhook-Id": id, "Basstok-Webhook-Timestamp": occurred,
          "Basstok-Webhook-Signature": `v1=${signature}`,
        }, body,
      });
    };
    assert.equal((await send("delivery", "wrong-secret")).status, 401);
    assert.equal(reads, 0);
    assert.equal((await send("delivery")).status, 204);
    assert.equal((await send("delivery")).status, 204);
    assert.equal(reads, 1);
    assert.equal(mutations, 1);
    assert.equal(refreshes, 1);
    assert.equal(observedAuthorization, "Bearer fixture-access-rotated");
    revoked = true;
    assert.equal((await send("after-revocation")).status, 204);
    assert.equal(mutations, 1);
    assert.equal(reads, 2);
    assert.deepEqual(failures, []);
    await close(receiver);
    receiver = undefined;
    // close emits before the credential lease's asynchronous release has completed.
    for (let attempt = 0; ; ++attempt) {
      try {
        const reopened = await RotatingCredentials.open(`${path}.credentials`, { basstokUrl: origin, clientId: "favorites" });
        assert.equal(await reopened.accessToken(), "fixture-access-rotated");
        await reopened.close();
        break;
      } catch (error) {
        if (attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.equal(refreshes, 1);
  } finally {
    if (receiver !== undefined) await close(receiver);
    await close(api);
    await rm(directory, { recursive: true, force: true });
  }
});

test("setup failure revokes a new grant and leaves no usable credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basstok-connect-failed-"));
  const path = join(directory, ".basstok-agent.json");
  let callback: Promise<Response> | undefined;
  let revocations = 0;
  try {
    await assert.rejects(connectAgent({ ...connection, callbackPort: await availablePort() }, {
      path, onReady: (url, redirect) => {
        callback = fetch(`${redirect}?state=${new URL(url).searchParams.get("state")}` +
          `&code=fixture-code&iss=${encodeURIComponent(connection.origin)}`);
      },
    }, async (url) => {
      if (url.toString().endsWith("/oauth/token")) return Response.json({
        access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "Bearer",
        expires_in: 3600, scope: "content:read", grant_id: "fixture-grant",
      });
      assert.ok(url.toString().endsWith("/oauth/revoke"));
      ++revocations;
      return new Response(null, { status: 200 });
    }), /scope set/);
    await callback;
    assert.equal(revocations, 1);
    const state = await readFile(`${path}.credentials`, "utf8");
    assert.equal(JSON.parse(state).state, "authorizing");
    assert.doesNotMatch(state, /fixture-access|fixture-refresh/);
    await assert.rejects(RotatingCredentials.open(`${path}.credentials`, {
      basstokUrl: connection.origin, clientId: connection.clientId,
    }), /authorize/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI offers useful help and rejects incomplete noninteractive setup before OAuth", async () => {
  for (const [args, expected, exit] of [
    [["--help"], /connect.*community-url/s, 0],
    [["connect", "https://community.example", "--agent", "unknown"], /Unknown Agent/, 1],
    [["connect", "https://community.example"], /Application ID.*required/, 1],
  ] as const) {
    const child = spawn(process.execPath, ["dist/src/cli.js", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, exit);
    assert.match(output, expected);
  }
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function availablePort(): Promise<number> {
  const server = createServer();
  const port = Number(new URL(await listen(server)).port);
  await close(server);
  return port;
}
