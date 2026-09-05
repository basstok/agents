import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertProtectedCredentialFileSupport,
  CredentialFileLease,
  RotatingCredentials,
} from "../src/credentials.js";
import type { OAuthTokens } from "../src/oauth.js";

const origin = "https://community.example";
const clientId = "test-agent";

test("credential-file storage fails closed without POSIX owner-only semantics", () => {
  assert.doesNotThrow(() => assertProtectedCredentialFileSupport("linux"));
  assert.throws(
    () => assertProtectedCredentialFileSupport("win32"),
    /requires POSIX owner-only file permissions/,
  );
});

test("authorization writes a protected credential file usable by the Agent", async () => {
  await withCredentialFile(async (path) => {
    await writeCredentials(path, tokenSet("current"), Date.now());
    const metadata = await stat(path);
    if (process.platform !== "win32") assert.equal(metadata.mode & 0o077, 0);

    const credentials = await RotatingCredentials.open(path, {
      basstokUrl: origin,
      clientId,
    }, unexpectedFetch);
    try {
      assert.equal(await credentials.accessToken(), "current-access");
      assert.equal(credentials.webhookSecret, "webhook-secret");
    } finally {
      await credentials.close();
    }
  });
});

test("one refresh is shared and the rotated token pair is committed atomically", async () => {
  await withCredentialFile(async (path) => {
    await writeCredentials(path, tokenSet("old"), 0);
    let refreshes = 0;
    const credentials = await RotatingCredentials.open(path, {
      basstokUrl: origin,
      clientId,
    }, async (input, init) => {
      refreshes += 1;
      assert.equal(input.toString(), `${origin}/oauth/token`);
      assert.deepEqual(
        [...new URLSearchParams(String(init?.body))],
        [
          ["grant_type", "refresh_token"],
          ["client_id", clientId],
          ["refresh_token", "old-refresh"],
        ],
      );
      return Response.json(tokenSet("next"));
    });
    try {
      assert.deepEqual(
        await Promise.all([
          credentials.accessToken(),
          credentials.accessToken(),
          credentials.accessToken(),
        ]),
        ["next-access", "next-access", "next-access"],
      );
      assert.equal(refreshes, 1);
      const persisted = JSON.parse(await readFile(path, "utf8")) as {
        state: string;
        access_token: string;
        refresh_token: string;
      };
      assert.equal(persisted.state, "ready");
      assert.equal(persisted.access_token, "next-access");
      assert.equal(persisted.refresh_token, "next-refresh");
    } finally {
      await credentials.close();
    }
  });
});

test("a zero-lifetime access token is stored but refreshed before use", async () => {
  await withCredentialFile(async (path) => {
    await writeCredentials(path, { ...tokenSet("expired"), expires_in: 0 }, 0);
    const credentials = await RotatingCredentials.open(path, {
      basstokUrl: origin,
      clientId,
    }, async () => Response.json(tokenSet("next")));
    try {
      assert.equal(await credentials.accessToken(), "next-access");
    } finally {
      await credentials.close();
    }
  });
});

test("an ambiguous refresh erases replayable secrets and requires authorization", async () => {
  await withCredentialFile(async (path) => {
    await writeCredentials(path, tokenSet("old"), 0);
    let refreshes = 0;
    const credentials = await RotatingCredentials.open(path, {
      basstokUrl: origin,
      clientId,
    }, async () => {
      refreshes += 1;
      throw new Error("connection ended without a response");
    });
    try {
      await assert.rejects(
        credentials.accessToken(),
        /authorize the Agent again/,
      );
      await assert.rejects(credentials.accessToken(), /require authorization/);
      assert.equal(refreshes, 1);
      const persisted = await readFile(path, "utf8");
      assert.match(persisted, /"state": "refreshing"/);
      assert.doesNotMatch(persisted, /old-access|old-refresh|webhook-secret/);
    } finally {
      await credentials.close();
    }

    await assert.rejects(
      RotatingCredentials.open(path, { basstokUrl: origin, clientId }),
      /interrupted/,
    );
  });
});

test("refresh cannot silently change the approved scope set", async () => {
  await withCredentialFile(async (path) => {
    await writeCredentials(path, tokenSet("old"), 0);
    const credentials = await RotatingCredentials.open(path, {
      basstokUrl: origin,
      clientId,
    }, async () => Response.json({
      ...tokenSet("broader"),
      scope: "content:read moderation:write",
    }));
    try {
      await assert.rejects(credentials.accessToken(), /authorize the Agent again/);
      const persisted = await readFile(path, "utf8");
      assert.match(persisted, /"state": "refreshing"/);
      assert.doesNotMatch(persisted, /broader-access|broader-refresh/);
    } finally {
      await credentials.close();
    }
  });
});

test("authorization tombstones old credentials before requesting a new grant", async () => {
  await withCredentialFile(async (path) => {
    await writeCredentials(path, tokenSet("old"), Date.now());
    const lease = await CredentialFileLease.acquire(path);
    try {
      await lease.writeAuthorizing({ basstokUrl: origin, clientId, now: 42 });
    } finally {
      await lease.release();
    }
    const persisted = await readFile(path, "utf8");
    assert.match(persisted, /"state": "authorizing"/);
    assert.doesNotMatch(persisted, /old-access|old-refresh|webhook-secret/);
    await assert.rejects(
      RotatingCredentials.open(path, { basstokUrl: origin, clientId }),
      /interrupted/,
    );
  });
});

test("credential files reject concurrent use and broad permissions", async () => {
  await withCredentialFile(async (path) => {
    await writeCredentials(path, tokenSet("current"), Date.now());
    const lease = await CredentialFileLease.acquire(path);
    try {
      await assert.rejects(CredentialFileLease.acquire(path), /already in use/);
    } finally {
      await lease.release();
    }

    if (process.platform !== "win32") {
      await chmod(path, 0o644);
      await assert.rejects(
        RotatingCredentials.open(path, { basstokUrl: origin, clientId }),
        /permissions are too broad/,
      );
    }
  });
});

test("credential reads reject symbolic links", async (context) => {
  if (process.platform === "win32") {
    context.skip("O_NOFOLLOW is a POSIX boundary");
    return;
  }
  await withCredentialFile(async (path) => {
    await writeCredentials(path, tokenSet("current"), Date.now());
    const linked = `${path}.linked`;
    await symlink(path, linked);
    await assert.rejects(
      RotatingCredentials.open(linked, { basstokUrl: origin, clientId }),
      /Protected file is invalid/,
    );
  });
});

test("a crashed credential-acquisition guard is recovered", async () => {
  await withCredentialFile(async (path) => {
    await writeFile(`${path}.lock.acquire`, JSON.stringify({
      pid: 2 ** 31 - 1,
      nonce: "a".repeat(32),
    }) + "\n", { mode: 0o600 });
    const lease = await CredentialFileLease.acquire(path);
    await lease.release();
  });
});

function tokenSet(prefix: string): OAuthTokens {
  return {
    access_token: `${prefix}-access`,
    token_type: "Bearer",
    expires_in: 3_600,
    refresh_token: `${prefix}-refresh`,
    scope: "content:read",
    grant_id: "grant",
  };
}

async function writeCredentials(
  path: string,
  tokens: OAuthTokens,
  now: number,
): Promise<void> {
  const lease = await CredentialFileLease.acquire(path);
  try {
    await lease.writeAuthorized({
      basstokUrl: origin,
      clientId,
      tokens,
      webhookSecret: "webhook-secret",
      now,
    });
  } finally {
    await lease.release();
  }
}

async function withCredentialFile(
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "basstok-agent-credentials-"));
  try {
    await run(join(directory, "credentials.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const unexpectedFetch: typeof fetch = async () => {
  throw new Error("unexpected refresh");
};
