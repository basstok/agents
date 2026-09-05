import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicId,
  idempotencyKey,
  isIdempotencyKey,
} from "../src/ids.js";

test("deterministic IDs are stable, UUID-shaped, and unambiguous", () => {
  const first = deterministicId("agent/action", "content", "member");
  assert.equal(first, deterministicId("agent/action", "content", "member"));
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(first, deterministicId("agent/action", "content-member"));
  assert.notEqual(
    deterministicId("agent/action", "ab", "c"),
    deterministicId("agent/action", "a", "bc"),
  );
});

test("idempotency keys are stable lowercase UUIDv4 values", () => {
  const first = idempotencyKey("chat", "member-a", "member-b");
  assert.equal(first, idempotencyKey("chat", "member-a", "member-b"));
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(isIdempotencyKey(first), true);
  assert.equal(isIdempotencyKey(first.toUpperCase()), false);
  assert.equal(isIdempotencyKey(first.replace("-4", "-5")), false);
  assert.notEqual(first, idempotencyKey("chat", "member-a", "member-c"));
});
