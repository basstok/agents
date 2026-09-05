# FAQ

## What is a Basstok Agent?

An Agent is an external program that uses the Basstok REST API and related
public network contracts to add an authorized capability or automation.

## Where does an Agent run?

Outside Basstok, in an environment operated by the Agent developer or service
operator. It needs ordinary HTTPS access to the Basstok community. An Agent
receiving public webhooks also needs a reachable HTTPS endpoint.

## Does an Agent run inside Basstok?

No. Agents are ordinary external HTTP clients.

## Does an Agent have to use TypeScript?

No. TypeScript keeps the included Agents short and readable. Any language with HTTP,
JSON, OAuth, and HMAC-SHA256 support can implement the same contracts.

## How does an Agent connect?

An Organization Manager registers an OAuth application. A Member authorizes its
requested scopes through authorization code flow with PKCE and selects ordinary
Labels whose Content the grant may access. The Agent then uses the access token
for Basstok REST requests. That Member remains responsible for the grant.

On a POSIX host and filesystem, the repository's authorization command stores
credentials in a verified owner-only local file rather than printing them. The
shared helper rotates short-lived access tokens and single-use refresh tokens
for a continuously running Agent. It refuses to use that credential-file path
on Windows, where Node.js cannot verify an owner-only ACL; the REST and webhook
contracts remain available to a Windows Agent with a platform-secure credential
store.

## How does authorization work?

OAuth scopes cap the Agent's requests. The Agent acts through a revocable grant
from one responsible human Member, sees only Content carrying Labels selected
for the grant, and cannot exceed that Member's current authority. Ordinary
authorization still applies to every object. Removing a permission, Label
selection, or the Member's underlying authority affects subsequent requests
and events.

## Can an Agent modify Content?

Yes, when the public API provides the operation, the OAuth grant includes the
required scope, and the responsible Member is currently authorized. Prefer the
narrow task-shaped endpoint for the intended change. A grant with
`content:write` but not `content:read` may receive only an ID acknowledging a
successful mutation, not the Content representation.

## Can an Agent read private Chats or Messages?

Only with explicit `chat:read` permission, and only through a Member that is a
participant in the exact Chat. That Member is the responsible human by default,
or a no-login persona explicitly selected and controlled by the same
application for that human. The scope is not tenant-wide, and an Agent cannot
fetch another Member's Chat by guessing its ID. A Member added later sees only
activity from its admission boundary forward. That later participant's Chat
response also omits the creator, creation time, and creation attribution because
those facts predate admission. `chat:write` does not imply read access.

## Can an Agent create a Member persona?

Yes, when its grant includes `member:write` and the responsible Member currently
has Manager authority. The result is a regular visible Member without a login
account. It can carry a public description, and Basstok presents attribution
for its application-created origin. The responsible human remains accountable.
The persona contributes Chat participation context, but no account or System
Label authority.

## Can an Agent access attachments?

Yes, under the same authorization boundary as the owning Content or Chat.
Content Assets require the Content scopes and selected Label; Chat Assets
require the appropriate Chat scope, current participation, and visibility from
the participant's admission boundary. An Asset ID is not an authorization
bypass.

## How should an Agent retry a create request?

Chat, Message, and Asset creates require a stable lowercase UUIDv4
`Idempotency-Key`. Retry the same logical create with the same key and request;
Basstok returns the same server-assigned resource. Reusing that key for a
different request conflicts. The key is not the resource ID, so use the ID in
the response for later operations. Content, Comment, and Member create routes
that place an ID in the path retain their documented exact-ID retry behavior.

## Can an Agent be disabled?

Yes. Its webhook, token, application grant, or application can be revoked as
appropriate. Official Agents also have Manager-facing enable and disable
controls on the Basstok Agents page. Disabling future automation does not undo
mutations already committed through the REST API.

## What if credential rotation is interrupted?

Stop the Agent, run `npm run authorize` again, then restart it. The included
helper closes its listener and fails closed rather than replaying a refresh
token whose single use may already have succeeded. It also prevents two Agent
processes from using the same credential file concurrently. Reusing the same
application and webhook IDs lets the same responsible Member move that
subscription to the fresh grant; Basstok rotates the webhook secret and revokes
the prior grant. Another Member or application cannot take it over.

## What happens if an Agent is offline?

Basstok remains usable without the external Agent. Webhooks are retry-safe
change signals, but an Agent must not treat them as a complete event history.
After an interruption, re-read current authorized resources before acting.

## What is the difference between official and third-party Agents?

Official Agents are maintained and presented by Basstok. Third-party Agents are
maintained by their own developer. Both integrate through the public OAuth,
REST, and event contracts.

The current official catalog includes Welcome guide, Help desk, Quick polls,
Discussion closeout, and Community favorites. Runnable TypeScript versions are
available in the repository's `agents/` directory.

## Is this repository a required SDK?

No. The helpers are compact reference code that keeps the included Agents
focused on their capability. Direct `fetch` calls are a supported and often
sufficient way to use the Basstok REST API.

## Where is the complete API reference?

Each Basstok community serves its OpenAPI document at `/openapi.json`.
