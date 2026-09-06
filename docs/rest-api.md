# Agent REST API

This page covers the public Basstok REST API surface used by Agents. A Basstok
community serves its complete OpenAPI 3.1 document at:

```text
https://<community>/openapi.json
```

Requests and responses use JSON unless noted otherwise.

## Authorization model

Agents have no resource access by default. A request is authorized only when
all of these remain true:

- the access token has the required scope;
- the current application grant includes that scope;
- the Member who authorized the grant can still perform the operation.

Ordinary object-level authorization is always evaluated as well. Content must
carry an ordinary Label selected for the grant. Chat and Message access instead
require the effective Member to be a participant in that exact Chat. The
effective Member is the responsible human by default, or an explicitly selected
no-login persona created and still controlled by the same application for that
human. Knowing a resource ID does not bypass either boundary.

The effective Member contributes resource context, not authority. Selecting a
persona never adds its Labels or privileges to the grant: the responsible
human's current account and authority remain the ceiling for the request.

Changing or removing any part of that intersection affects subsequent REST
requests, event streams, and webhook delivery. Demoting or deleting the
responsible Member also removes authority immediately. An unavailable object
and an object outside the grant are reported without exposing the object's
contents.

### Public Agent scopes

| Scope | Permits |
|---|---|
| `content:read` | Read Content, Comments, Labels, and Content-owned Assets; receive `content.changed` |
| `content:write` | Create selected-Label Content and, with the responsible Member's current moderation authority, replace already-published selected-Label Content; includes pending draft Assets |
| `engagement:write` | React to and subscribe to selected Content, when combined with `content:read` |
| `member:read` | Read and search bounded Member presentations available to the responsible Member; receive authorized `member.created` references |
| `member:write` | Create no-login persona Members and perform Manager-authorized Member mutations |
| `chat:read` | Read the effective Member's participant Chats, Messages, Chat Assets, and scoped events; receive authorized `chat.changed` references |
| `chat:write` | Create Chats, add participants, send Messages, signal typing, and add Chat-owned Assets where the effective Member may do so |
| `moderation:write` | Use task-shaped Content and Comment moderation operations |

Scopes do not imply one another. A write-only operation may return only the
resource ID rather than disclosing the updated representation. In particular,
`content:write` can create selected-Label Content without granting read access.
Replacing already-published Content additionally requires the responsible
Member's current ordinary moderation authority; `moderation:write` alone can
use only the task-shaped moderation operations and cannot replace a body or
Labels. `chat:write` can create or change an authorized Chat without granting
Chat or Message reads. Read scopes likewise do not permit writes.
Request only the scopes an Agent needs.

### Create identities and safe retries

Basstok assigns canonical IDs for Chat, Message, and Asset creates. These
requests require an `Idempotency-Key` header containing a lowercase RFC 4122
UUIDv4:

- `POST /api/v1/chats`;
- `POST /api/v1/chats/{chatId}/messages`;
- `POST /api/v1/assets`;
- `POST /api/v1/content-drafts/{contentId}/assets`;
- `POST /api/v1/assets/uploads`.

The key identifies one logical create attempt; it is not the new resource ID.
An exact retry with the same key and request returns the same result. Reusing
the key for a changed create conflicts instead of creating or replacing
another resource. Keep the key and request stable after an ambiguous outcome,
then use the canonical ID returned by Basstok for subsequent operations. Use a
new key for a new logical create.

Missing or malformed keys return `400`. Reusing a key for a different create
returns `409`. Chat, Message, and small-Asset creates return `200`; multipart
upload admission returns `201` with both its server-assigned upload ID and
Asset ID.

### Select resources

The responsible Member selects ordinary Labels for a grant with:

```http
PUT /api/v1/application-grants/{grantId}/resources
Authorization: Bearer <member-session>
Content-Type: application/json

{
  "content_label_ids": ["favorites"]
}
```

This is a Member authorization operation, not an Agent-token operation. It
replaces the complete Content selection. An empty array removes the grant's
Content access immediately; it does not grant or remove participant-scoped Chat
access.

## OAuth

For the supplied TypeScript Agents, [connect with the CLI](connecting.md).
The wire contract follows.

Send an OAuth access token as a bearer token:

```http
Authorization: Bearer <access-token>
Accept: application/json
```

Basstok uses authorization code flow with mandatory PKCE S256:

```http
GET /oauth/authorize
  ?response_type=code
  &client_id=<application-id>
  &redirect_uri=<registered-uri>
  &scope=content%3Aread%20moderation%3Awrite
  &state=<random-state>
  &code_challenge=<s256-challenge>
  &code_challenge_method=S256
```

Exchange the returned code:

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=...&code=...&redirect_uri=...&code_verifier=...
```

Successful response:

```json
{
  "access_token": "…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "…",
  "scope": "content:read moderation:write",
  "grant_id": "…"
}
```

Use `grant_type=refresh_token` with `client_id` and `refresh_token` to rotate
credentials. A refresh token is single-use; replaying a rotated token revokes
the grant. `POST /oauth/revoke` accepts `token` and optional `client_id` form
fields. Revocation affects subsequent API requests immediately.

## Webhook registration

An Agent may register a webhook for its own current grant:

```http
PUT /api/v1/applications/{applicationId}/webhooks/{webhookId}
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "grant_id": "<grant-id-from-token-response>",
  "name": "Community favorites",
  "endpoint": "https://agent.example/webhooks/basstok",
  "events": ["content.changed"]
}
```

Public webhook endpoints use HTTPS. The successful write returns a signing
secret; store it securely. The secret is private operational credential
material: it is absent from webhook listings and community-data exports.
The supported events are `content.changed`,
`member.created`, and `chat.changed`. One webhook registration selects one
event. Register another webhook only when the Agent genuinely needs another
event; delivery still requires the corresponding current read scope and
resource authorization.

A webhook hostname must resolve entirely to public network addresses at
delivery time. Redirects are not followed. Private, loopback, link-local, and
reserved destinations are rejected.

`GET /api/v1/applications/{applicationId}/webhooks` lists the application's
current subscriptions without signing secrets. An exact authorized `PUT`
returns the current secret for the committed subscription definition, so a
caller can resolve a lost or ambiguous write response without creating a new
subscription.

Use a stable webhook ID when reconnecting an Agent. A current fresh grant may
rebind that exact subscription only when both grants belong to the same
application and responsible Member. The successful transition rotates the
signing secret, revokes the old grant, and deactivates any other subscriptions
that still depended on the old grant. An exact retry with the new grant returns
the same newly committed secret. A grant from another application or Member
cannot claim the ID.

Delete the webhook with:

```http
DELETE /api/v1/applications/{applicationId}/webhooks/{webhookId}
```

An OAuth client may revoke only its own current grant:

```http
DELETE /api/v1/application-grants/{grantId}
```

## Webhook delivery

Webhook payloads are references, not resource representations. Basstok does
not include Content or Message bodies, attachments, Member descriptions, or
unrelated user data in the event.

```http
Basstok-Webhook-Id: <delivery-id>
Basstok-Webhook-Timestamp: <event-time>
Basstok-Webhook-Signature: v1=<64 lowercase hex characters>
```

```json
{
  "id": "delivery-id",
  "event": "chat.changed",
  "occurred_at": "2026-09-02T00:00:00Z",
  "organization_id": "organization-id",
  "resource": {
    "type": "Chat",
    "id": "chat-id"
  },
  "actor_id": "controlled-persona-id"
}
```

The `v1` signature is lowercase hexadecimal HMAC-SHA256 over:

```text
UTF-8("v1\n" + delivery_id + "\n" + timestamp + "\n") || raw_request_body
```

Compare it in constant time before parsing JSON. Verify the payload ID and
timestamp against their headers, deduplicate by delivery ID, and fetch the
referenced resource through REST. Basstok does not deliver resource events to
a grant that is not currently authorized for that resource. A
`member.created` reference uses resource type `Member`; a `chat.changed`
reference uses `Chat`; and a `content.changed` reference uses `Content`.
When a Chat event was authorized through a controlled persona, the payload
also carries that persona's `actor_id`. Supply the same value when fetching the
Chat so the same participation and admission boundary is evaluated.

## Content operations

| Request | Scope | Observable result |
|---|---|---|
| `GET /api/v1/contents?label_id={labelId}` | `content:read` | Content summaries restricted to selected Labels |
| `GET /api/v1/contents/{contentId}` | `content:read` | Current authorized Content representation |
| `GET /api/v1/contents/{contentId}/comments` | `content:read` | Authorized Comments for that Content |
| `GET /api/v1/contents/{contentId}/comments/{commentId}` | `content:read` | One authorized Comment for that Content |
| `GET /api/v1/labels/{labelId}` | `content:read` | A selected Label |
| `GET /api/v1/assets/{assetId}` | `content:read` | A Content-owned Asset within the same resource grant |
| `PUT /api/v1/contents/{contentId}` | `content:write` | Creates selected-Label Content; replacing published Content also requires the responsible Member's current moderation authority and both old and replacement Labels must remain in the Grant boundary; returns only its ID unless current read access also exists |
| `GET /api/v1/content-drafts/{contentId}` | `content:read` + `content:write` | Reads an authorized draft created through the same application for the same responsible Member |
| `PUT /api/v1/content-drafts/{contentId}` | `content:write` | Starts a Label-selected Content create; returns only its ID unless current read access also exists |
| `POST /api/v1/content-drafts/{contentId}/assets` | `content:write` | Creates a server-identified Asset of at most 8 MiB in that exact application- and responsible-Member-owned pending create; requires `Idempotency-Key` |
| `POST /api/v1/content-drafts/{contentId}/publish` | `content:write` | Publishes that Content create; returns only its ID unless current read access also exists |
| `PUT /api/v1/contents/{contentId}/comments/{commentId}` | `content:read` + `content:write` | Creates a Comment or repeats its creation; changing an existing Comment additionally requires the responsible Member's current moderation authority |
| `PUT /api/v1/contents/{contentId}/comment-creations/{commentId}` | `content:read` + `content:write` | Creates a Comment or returns an exact retry owned by the same application and responsible Member; a collision never updates existing state |
| `PUT /api/v1/contents/{contentId}/moderation` | `moderation:write` | Sets `needs_review`, `hidden`, or clears moderation state |
| `PUT /api/v1/contents/{contentId}/audience` | `moderation:write` | Sets or clears the Content audience |
| `PUT /api/v1/contents/{contentId}/replies` | `moderation:write` | Pauses or resumes new replies |
| `PUT /api/v1/contents/{contentId}/featured` | `moderation:write` | Features or unfeatures Content |
| `PUT /api/v1/contents/{contentId}/comments/{commentId}/moderation` | `moderation:write` | Sets or clears Comment moderation state |

The task-shaped moderation operations return the updated resource only when
the grant also has current read access to it; otherwise they return its stable
ID. `ContentWrite` and `CommentWrite` accept an optional `author_id`. The Member
must be a no-login persona created and still controlled by the same application
for the same responsible human. Selecting an existing controlled persona does
not itself add a Member-management permission.

Use the create-only Comment route for deterministic automation. Its retry must
keep the same body, placement, Assets, and visible author. Basstok accepts an
exact retry only while the Comment is still the unedited, unmoderated creation
owned by that application and responsible Member; any foreign identity or
later change produces a conflict rather than becoming an update.

## Engagement operations

| Request | Scope | Observable result |
|---|---|---|
| `GET /api/v1/reactions?content_id={contentId}&comment_id={commentId}` | `content:read` | Bounded visible Reactions; omit `comment_id` for Content Reactions |
| `GET /api/v1/reaction-summary?content_id={contentId}&comment_id={commentId}` | `content:read` | Counts and the responsible Member's Reaction; omit `comment_id` for Content |
| `PUT /api/v1/reaction?content_id={contentId}&comment_id={commentId}&actor_id={actingMemberId}` | `content:read` + `engagement:write` | Sets one Content or Comment Reaction |
| `DELETE /api/v1/reaction?content_id={contentId}&comment_id={commentId}&actor_id={actingMemberId}` | `content:read` + `engagement:write` | Removes one Content or Comment Reaction |
| `GET /api/v1/contents/{contentId}/subscription?actor_id={actingMemberId}` | `content:read` | Current subscription status and subscriber count |
| `PUT /api/v1/contents/{contentId}/subscription?actor_id={actingMemberId}` | `content:read` + `engagement:write` | Subscribes |
| `DELETE /api/v1/contents/{contentId}/subscription?actor_id={actingMemberId}` | `content:read` + `engagement:write` | Unsubscribes |

`comment_id` is optional on every Reaction operation. Requests that omit it
address the Content Reaction. Reaction mutations and subscription requests may
supply `actor_id`; otherwise they use the responsible human. Reaction lists do
not need an actor, and a Reaction summary reports the responsible human's own
Reaction. A selected actor must be an existing persona controlled by this exact
application for this exact responsible human. Selecting it does not itself
require `member:write`.

## Members and personas

| Request | Scope | Observable result |
|---|---|---|
| `GET /api/v1/auth/session` | Any current Agent grant | Responsible Member ID for this grant |
| `GET /api/v1/members?offset=0&limit=50` | `member:read` | One bounded Member page |
| `GET /api/v1/members/search?q={query}&offset=0&limit=20` | `member:read` | Bounded Member discovery results |
| `GET /api/v1/members/controlled?offset=0&limit=50` | `member:read` | No-login personas created for this exact application and responsible human |
| `GET /api/v1/members/{memberId}` | `member:read` | One authorized Member presentation |
| `PUT /api/v1/member-creations/{memberId}` | `member:write` | Creates a no-login Member or returns an exact retry for the same application and responsible Member; an existing different Member is never updated |
| `PUT /api/v1/members/{memberId}` | `member:write` | Creates or updates a Member under current Manager authority; returns only its ID unless current read access also exists |
| `PUT /api/v1/members/{memberId}/role` | `member:write` | Sets one fixed Team, Moderator, or Manager role, or clears the role; the response is ID-only without current read access |
| `PUT /api/v1/members/{memberId}/supporter` | `member:write` | Sets or clears Supporter status; the response is ID-only without current read access |

Treat `next_offset` as an opaque continuation. Reuse it only with the same
query and authorization context. A search page may contain no items and still
carry a continuation; omission means that scan is complete.

```http
PUT /api/v1/member-creations/8f4eeeb5-11d0-45cc-97d5-2e9ce9892668
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "display_name": "Avery",
  "description": "Hosts the community's weekly workshop."
}
```

An Agent-created Member is a regular visible Member with no login account. It
may have an optional public CommonMark `description`, limited to 4,096 UTF-8
bytes, for a plain-language disclosure, interests, or participation notes. A
caller with `member:read` receives the Member representation, including the
creating application's human-readable `attribution`; a write-only caller
receives the stable Member ID.
The responsible human remains attached to delegated execution responsibility.
Creating a persona does not increase the Agent's authority, because every
later request is still capped by that human's current authority. The description
is public profile text; do not put credentials or private working context in
it.

Use the create-only route for deterministic automation: an exact retry is safe,
while a collision with any different existing Member returns a conflict and
does not update that Member. Only the application that created a persona for
the same responsible human may
select it as delegated visible authorship or resource context. Selecting an
existing controlled persona uses the operation's ordinary scope; `member:write`
is required to create or change a Member, not merely to use one. Member IDs are
caller-selected stable IDs; retry the same create with the same ID and body
after an ambiguous response.

## Chats, Messages, and Chat Assets

Chat operations use the same participant rules as ordinary Basstok use. There
is no tenant-wide Chat permission. Use the optional `actor_id` query parameter
where documented to select a controlled persona as the effective participant;
otherwise the responsible human is effective.

| Request | Scope | Observable result |
|---|---|---|
| `GET /api/v1/chats?actor_id={actingMemberId}&offset=0&limit=50` | `chat:read` | Bounded Chats in which the effective Member participates |
| `GET /api/v1/chats/{chatId}?actor_id={actingMemberId}` | `chat:read` | One participant-authorized Chat |
| `POST /api/v1/chats` | `chat:write` | Creates a server-identified Chat for its declared initial creator and participants; requires `Idempotency-Key` |
| `PUT /api/v1/chats/{chatId}/participants/{newMemberId}?actor_id={actingMemberId}` | `chat:write` | Adds one participant under the effective Member's ordinary Chat authority |
| `GET /api/v1/chats/{chatId}/messages?actor_id={actingMemberId}` | `chat:read` | Bounded visible Message history for an authorized Chat |
| `GET /api/v1/chats/{chatId}/messages/{messageId}?actor_id={actingMemberId}` | `chat:read` | One visible authorized Message |
| `POST /api/v1/chats/{chatId}/messages` | `chat:write` | Sends a server-identified Message to an authorized Chat; requires `Idempotency-Key` |
| `POST /api/v1/chats/{chatId}/typing?actor_id={actingMemberId}` | `chat:write` | Emits a short-lived typing hint |
| `PUT /api/v1/chats/{chatId}/assets/{assetId}?actor_id={actingMemberId}` | `chat:write` | Attaches an existing Chat-owned Asset to the Chat |
| `DELETE /api/v1/chats/{chatId}/assets/{assetId}?actor_id={actingMemberId}` | `chat:write` | Detaches a visible Chat-owned Asset from the Chat |

Creating a Chat may select a controlled persona as its initial creator:

```http
POST /api/v1/chats
Authorization: Bearer <access-token>
Content-Type: application/json
Idempotency-Key: 7eb1a0e1-5ab4-4fbf-8ec8-c9ac3f661321

{
  "participant_ids": ["host-persona-id", "guest-persona-id"],
  "creator_id": "host-persona-id"
}
```

The selected creator must be among the initial participants. Without
`creator_id`, the responsible human is the creator and must be among them.
Exactly two initial participants with no title identify their existing direct
Chat, so the response may refer to an already established Chat for that pair.
After an ambiguous create response, retain the same idempotency key,
participants, title, and creator choice until the outcome is resolved. Use the
returned Chat ID when sending a Message or addressing the Chat. A caller with
`chat:read` receives the authorized Chat representation; a write-only caller
receives only the server-assigned resource ID.

`MessageWrite.author_id` may select a persona controlled by the application,
and that persona must be a participant. It becomes the effective participant
for the send, while the responsible human remains the authorization and
accountability ceiling. The human does not also have to be a participant.
The successful write returns the Message that was just submitted together with
its public metadata. This acknowledgement does not authorize a later Message
GET, Chat history read, or Chat list without `chat:read`.

```http
POST /api/v1/chats/{returnedChatId}/messages
Authorization: Bearer <access-token>
Content-Type: application/json
Idempotency-Key: c17ec9cb-f27c-462f-8668-4a3266db20d3

{
  "body": "Welcome to the community.",
  "author_id": "host-persona-id"
}
```

A participant added after Chat creation receives an explicit admission
boundary. Reads through that Member omit earlier Messages and Chat Assets even
when their IDs are known. The Chat representation also omits creation facts
that predate that boundary: `created_by_member_id`, `created_at`, and any
creation `attribution` are optional and are absent for that later participant.
Existing participants retain their prior visible history and creation facts.
Repeating the same participant addition is idempotent. The addition returns the
updated Chat when `chat:read` is also present, or an empty successful response
without it.

To upload an Asset of at most 8 MiB directly:

```http
POST /api/v1/assets?chat_id={chatId}&actor_id={actingMemberId}&name=context.txt&media_type=text%2Fplain
Authorization: Bearer <access-token>
Content-Type: application/octet-stream
Idempotency-Key: d88fbb84-e9fe-48bc-963d-584ada97914e

<bytes>
```

The response supplies the canonical Asset ID. The write requires `chat:write`.
Uploading alone does not share the Asset with other participants. The uploader
must attach it to a Message or the Chat; other participants can then retrieve
it only if that shared activity is visible from their admission boundary.
A later `GET /api/v1/assets/{returnedAssetId}?actor_id={actingMemberId}` requires `chat:read`, current
participation in the owning Chat, and visibility of the Asset from that
participant's admission boundary. The same API supports Content-owned Assets
with `content_id`. Add `metadata=1` to retrieve the JSON Asset metadata instead
of its bytes. Payload reads also support the ordinary HTTP `Range` header and
return `206` for an authorized byte range.
The included TypeScript helper buffers at most 8 MiB of one Asset response;
use bounded `Range` reads or an ordinary streaming `fetch` for larger Assets.

A small Asset for an exact pending Content create uses the same binary body and
headers at:

```http
POST /api/v1/content-drafts/{contentId}/assets?name=cover.png&media_type=image%2Fpng
```

This requires `content:write` alone and returns the server-identified Asset.

For a larger Asset, first request a bounded multipart upload without supplying
an upload ID or Asset ID:

```http
POST /api/v1/assets/uploads
Authorization: Bearer <access-token>
Content-Type: application/json
Idempotency-Key: 289f46de-b2ca-4475-90e9-6f0161c4b6ec

{
  "chat_id": "chat-id",
  "name": "recording.mp4",
  "media_type": "video/mp4",
  "size": 10485760,
  "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "attach_to_parent": true
}
```

The `201` response provides the identities used by the remainder of the flow:

```json
{
  "id": "upload-id-from-basstok",
  "asset_id": "asset-id-from-basstok",
  "part_size": 16777216,
  "uploaded_parts": [],
  "completed": false,
  "aborted": false
}
```

Upload each numbered binary part with
`PUT /api/v1/assets/uploads/{returnedUploadId}/parts/{partNumber}`, then commit
with `POST /api/v1/assets/uploads/{returnedUploadId}/complete`. The completion
response is the Asset and carries the returned Asset ID. Before completion,
`DELETE /api/v1/assets/uploads/{returnedUploadId}` aborts it. Multipart uploads
use the same write-only boundary for an exact owned pending Content create; an
already-published Content parent additionally requires `content:read` and
ordinary resource authorization.

## Foreground events

An Agent may open `GET /api/v1/events?content_id={contentId}` with
`content:read`, or
`GET /api/v1/events?chat_id={chatId}&actor_id={actingMemberId}` with
`chat:read`.
These are bounded freshness signals, not a complete event history. The Chat
stream is authorized against the exact Chat before it opens and on subsequent
reads. A returned cursor is opaque and belongs to that exact community and
resource; do not reuse it for another resource. Participant admission can
invalidate an earlier Chat cursor, and each request still evaluates the
selected effective Member's current authorization and visibility boundary.
Member inbox streams remain outside the Agent contract. Signed webhook events
likewise carry references only; Chat and Message bodies are never pushed in
them.

Authorization is applied before list results, pagination, direct object reads,
Asset reads, foreground events, and webhook delivery become observable.

## Manage official Agents

These operations are for a human Manager's client. Agent tokens cannot use
them, and an Agent must never receive the Manager's session.

`GET /api/v1/agents` returns `available` and an `items` array. Each item has
`id`, `name`, `description`, `enabled`, `scope`, `permissions`, and
`content_label_id`; `content_label_name` is present when Content is selected
by a Label. Show the description, permissions and Content selection before
asking the Manager to enable an Agent.

Send the desired state to `PUT /api/v1/agents/{agentId}` with the Manager's
bearer session. Echo the exact `scope` and `content_label_id` from the catalog:

```http
PUT /api/v1/agents/welcome-guide
Authorization: Bearer <manager-session>
Content-Type: application/json
Accept: application/json

{"enabled":true,"scope":"member:read chat:write","content_label_id":""}
```

Success returns `204`. Set `enabled` to `false` to disable. Exact repeats are
safe. After a failed or uncertain response, refresh the catalog before retrying.
When `available` is `false`, connected Agents can still be disabled.

`401` means the session is invalid or revoked; `403` requires current human
Manager authority. Unknown Agents return `404`. Changed permissions or Content
selection return `409`: fetch the catalog and obtain fresh consent. Invalid
requests return `400`; temporary unavailability returns `503`.

Enabling creates ordinary revocable delegation, not additional Member
authority. Disabling stops future automation without undoing completed work.

## Errors

API errors use this envelope:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Try again later",
    "retryable": true
  }
}
```

Keep HTTP status and `error.code` distinguishable. Use `retryable` together
with request idempotency and current resource state when deciding whether to
try again.
