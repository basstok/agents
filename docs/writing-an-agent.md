# Writing an Agent

Start with one customer capability and the narrowest public operations that can
express it. An Agent remains an ordinary external program:

```text
signed webhook reference
    → authorized REST read
    → small decision
    → authorized REST mutation
```

The files under [`agents/`](https://github.com/basstok/agents/tree/main/agents)
are complete runnable programs. The helpers under `src/` remove repeated
protocol ceremony, but they do not replace or extend the Basstok REST API.

## Keep the capability visible

Community favorites is mostly its product rule:

```ts
await serveAgentWebhooks({
  name: "Community favorites",
  onContentChanged: async (content, api) => {
    const selected = content.labels.some(({ id }) => id === favoritesLabelId);
    if (selected && !content.system_labels.includes("featured")) {
      const reactions = await api.getReactionSummary(content.id);
      if (reactions.total_count >= 5) await api.setFeatured(content.id, true);
    }
  },
});
```

`serveAgentWebhooks` provides a bounded HTTP listener, verifies each signature
against the exact body, checks envelope metadata, deduplicates active and recent
deliveries, serializes changes for the same resource, re-reads the referenced
resource, and returns a failure when work did not settle. Developers who need a
different deployment shape can implement the same documented HTTPS and HMAC
contract directly.

## Request the smallest scopes

Scopes are independent caps. Community favorites needs only:

- `content:read` to receive and re-read selected Content and its reaction
  summary;
- `moderation:write` to use the task-shaped feature operation.

It does not request Content creation, Member, or Chat access. The
[Official Agents](official-agents.md) page lists the exact scopes for every
included capability.

Every grant has exactly one responsible human Member. Effective authority is:

```text
granted scope
∩ current application grant
∩ responsible Member's current authority
∩ ordinary resource authorization
```

For Content, the ordinary Labels selected on the grant add its resource
boundary. For a Chat operation, the effective Member must be a participant in
that exact Chat. A controlled no-login Member may provide visible authorship or
participant context where the API accepts `author_id` or `actor_id`, but it
never contributes account authority.

## Treat webhooks as references

Webhooks identify a changed resource. They do not contain Content or Message
bodies, Member descriptions, attachments, or an event history. The shared
receiver fetches the current authorized representation before calling
`onContentChanged`, `onMemberCreated`, or `onChatChanged`.

If that dereference now returns `403` or `404`, the receiver settles the change
without calling the capability: access was revoked or the resource is no longer
available. The receiver also settles a non-retryable REST rejection if authority,
the target, or a stable mutation conflict changes between that read and the
capability's mutation. A retryable `409`, `429`, or server failure remains
unsettled so normal webhook retry can recover it.

If a controlled Member supplied the context for `chat.changed`, the receiver
uses the event's `actor_id` when fetching the Chat. This preserves the same
participant and admission boundary as the event. Code reading a Chat should
treat `created_by_member_id`, `created_at`, and `attribution` as optional: a
participant admitted after creation does not receive pre-admission creation
facts.

The underlying delivery contract remains explicit:

1. preserve the exact body bytes;
2. verify `Basstok-Webhook-Signature` before parsing;
3. check the payload ID and time against the headers;
4. deduplicate `Basstok-Webhook-Id`;
5. fetch current state with the OAuth token;
6. acknowledge only after the action settles.

The receiver's recent-delivery set is bounded and in memory. The included
Agents also make their effects converge through stable create identities and
current-state checks, so a replay after restart is safe. Persist delivery IDs
in your own operational store when an Agent performs a non-idempotent external
side effect.

## Make retries converge

Prefer task-shaped mutations and inspect current state before changing it:

```ts
if (!content.system_labels.includes("featured")) {
  await api.setFeatured(content.id, true);
}
```

Content, Comment, and Member create operations that include the resource ID in
their path use a stable UUID-shaped ID. The included `deterministicId` helper
derives that same ID from the capability and source resource on every retry.

Chat, Message, and Asset creates instead use a required lowercase UUIDv4
`Idempotency-Key`. The included `idempotencyKey` helper derives one stable key
for a logical create. Keep the request body and key identical after an
ambiguous response. The key is not a resource ID: Basstok assigns the canonical
ID and returns it. Always use that returned ID for later operations. This also
handles a direct Chat that already exists under a different canonical ID.

Discussion closeout demonstrates ordered recovery. It first looks up its
deterministic recap Comment. When absent, it follows monotonic oldest-first
pagination within the public 100,000-Comment bound, carrying ancestor
visibility across pages, and stops at the first 20 ordinary-visible Comments.
It creates the recap through the create-only route and only then pauses
replies. After a lost response, it asks Basstok to confirm the stored,
unmodified Comment as an exact create owned by the same application and
responsible Member before finishing the pause; it does not recompute or rewrite
an already committed snapshot. A foreign or edited Comment at the predictable
ID is not treated as a receipt.

## Keep bounded work obvious

Webhook bodies, connections, request time, concurrent deliveries, recent
delivery IDs, list pages, text, and parsed poll choices are bounded. The
included receiver admits at most 16 connections and two active deliveries,
with a 15-second request deadline. The client bounds a JSON response at 72 MiB
so it can read the complete public resource envelope. Do not turn one event
into an unbounded Member or Comment scan. Use pagination deliberately when a
capability truly needs more than one page.

## Handle authorization and failure

- `401`: refresh the access token or reconnect the grant.
- `403`: current scope, grant, responsible-Member authority, or object access
  does not permit the operation. Do not retry unchanged authority.
- `404`: the resource is absent or unavailable to this grant.
- `409`: re-read current state before deciding whether the same stable mutation
  is safe.
- `429` or a retryable `5xx`: apply bounded backoff.

Basstok errors include a stable code, message, and `retryable` boolean. Removing
a scope, Label selection, grant, application, or the responsible Member's
authority affects subsequent reads, mutations, and event delivery.

## Connect with OAuth and PKCE

Use authorization code flow with mandatory PKCE S256. Generate new
high-entropy `state` and verifier values for every authorization, verify `state`
on callback, require the callback's `iss` value to match the Basstok origin,
and exchange the code at `/oauth/token`.

Access tokens are short-lived bearer credentials. Keep access tokens, rotating
refresh tokens, and webhook signing secrets out of source control and logs.
The runnable [`tools/authorize.ts`](https://github.com/basstok/agents/blob/main/tools/authorize.ts)
performs the external flow using Node.js cryptography and standard `fetch`, then
atomically writes a small, verified owner-only operational credential file on
a POSIX host and filesystem. The bundled credential-file helper refuses to run
on Windows because Node.js file mode bits cannot prove an owner-only Windows
ACL; use an equivalent platform-secure credential store when implementing a
Windows Agent. The shared receiver obtains a current access token before each
request and rotates the single-use refresh token early. It replaces the stored
token pair atomically before publishing the new access token to Agent code, and
rejects a refresh that changes the approved scope set or grant identity.

Only one Agent process may own a credential file. If a refresh has an ambiguous
outcome or the process stops during rotation, the file contains no replayable
token or webhook secret; the included receiver closes and startup requires
authorization again. This fail-closed choice avoids replaying a single-use
refresh token and inadvertently revoking the grant. The credential file is
local Agent operational state, not community data; do not commit, log, or
hand-edit it.

Reauthorization should reuse the Agent's stable application and webhook IDs.
For the same responsible Member, a successful webhook write takes over the old
subscription for the fresh grant, rotates its signing secret, and revokes the
old grant. Store the returned secret together with the new token set before
starting the listener. An exact retry recovers the committed secret after an
ambiguous response. Another application or responsible Member cannot use this
mechanism to take over the subscription.

## Operate it like a normal service

Terminate public TLS in your deployment, keep secrets out of the repository,
set upstream timeouts, shut down cleanly, and monitor `/healthz`. The included
client requires HTTPS outside loopback development, gives each outbound request
a 30-second deadline, and bounds buffered responses; use streaming or bounded
Range requests when an Asset is larger than its 8 MiB buffer.
An Agent outage never prevents Basstok from serving the community. After an
interruption, trust current authorized REST state rather than assuming every
webhook was received.
