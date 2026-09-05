# Getting started

This guide runs Welcome guide. It receives a `member.created` reference,
re-reads the Member, and sends a direct welcome through ordinary Basstok REST
operations.

## Prerequisites

- Node.js 24 LTS or newer;
- a POSIX host and filesystem for the included credential-file helper;
- a Basstok community URL;
- an HTTPS URL that can receive your Agent's webhook;
- an Organization Manager who can register and authorize the application.

The Agent has no runtime package dependencies. The public REST and webhook
contracts are platform-independent, but the included runnable helper stops on
Windows because Node.js cannot verify an owner-only Windows ACL. A Windows
deployment needs an equivalent platform-secure credential-store integration.

## 1. Get the Agent

```sh
git clone https://github.com/basstok/agents.git my-basstok-agent
cd my-basstok-agent
npm ci
npm run build
cp .env.example .env.local
```

`.env.local` and the default credential file are ignored by Git. Never commit
access tokens, refresh tokens, or webhook signing secrets.

## 2. Register the OAuth application

Using an authorized Manager Member session, register a public OAuth client:

```http
PUT /api/v1/applications/welcome-guide
Authorization: Bearer <manager-member-session>
Content-Type: application/json

{
  "name": "Welcome guide",
  "redirect_uris": ["http://127.0.0.1:3001/callback"],
  "allowed_scopes": ["member:read", "chat:write"]
}
```

The Manager session is used only for application management. The Agent receives
its own bounded OAuth grant.

Set the external endpoints and exact capability in `.env.local`:

```dotenv
BASSTOK_URL=https://community.example
BASSTOK_CLIENT_ID=welcome-guide
BASSTOK_AGENT_NAME=Welcome guide
BASSTOK_SCOPES=member:read chat:write
BASSTOK_WEBHOOK_ID=welcome-guide
BASSTOK_WEBHOOK_EVENT=member.created
BASSTOK_WEBHOOK_URL=https://agent.example/webhooks/basstok
BASSTOK_CREDENTIALS_FILE=.basstok-agent-credentials.json
```

The webhook URL must be reachable over HTTPS. During local development, use an
HTTPS forwarding tool of your choice.

## 3. Authorize and register the webhook

```sh
npm run authorize
```

Open the printed URL. Basstok asks the responsible Member to approve the two
scopes, then redirects to the local callback. The authorization tool uses
authorization code flow with mandatory PKCE S256 and registers the selected
webhook.

On its supported POSIX host and filesystem, the command writes the access
token, rotating refresh token, grant identity, and webhook signing secret to
`BASSTOK_CREDENTIALS_FILE` with verified owner-only permissions. It does not
print credentials. The running Agent reads that file and atomically persists
each refresh-token rotation before using the new access token. Run only one
Agent process against a credential file.

If authorization or refresh is interrupted, stop the Agent, run
`npm run authorize` again, and restart it. The helper deliberately stops its
listener and will not replay a possibly consumed refresh token. Keep the same
stable `BASSTOK_WEBHOOK_ID`: when the same application is authorized again by
the same responsible Member, registering that ID moves it to the fresh grant,
rotates its signing secret, and revokes the prior grant. A different
application or responsible Member cannot take over the subscription. Recheck
the new grant's selected Content Labels before restarting a Content Agent.

Welcome guide needs no Content Label. Content-based Agents additionally require
the responsible Member to select their ordinary Label on the application grant;
their exact setup is listed under [Official Agents](official-agents.md).

## 4. Run it

```sh
npm start
```

The Agent listens on port 3000 by default. `GET /healthz` reports process health
and `POST /webhooks/basstok` receives signed deliveries.

For a newly created Member without Agent creation attribution, the capability is simply:

```ts
import { idempotencyKey } from "../src/ids.js";

const responsible = await api.getSession();
if (member.attribution === undefined && member.id !== responsible.member_id) {
  await api.sendDirectMessage({
    chatIdempotencyKey: idempotencyKey("welcome/chat", responsible.member_id, member.id),
    messageIdempotencyKey: idempotencyKey("welcome/message", responsible.member_id, member.id),
    responsibleMemberId: responsible.member_id,
    recipientMemberId: member.id,
    body: "Welcome to the community.",
  });
}
```

The shared receiver verifies and deduplicates the webhook before it re-reads the
Member. The Agent skips application-created Members, so it cannot welcome its
own automated creations. Stable create keys make a repeated delivery converge
on the same server-identified Chat and Message.

## 5. Choose another capability

The [`agents/`](https://github.com/basstok/agents/tree/main/agents) directory
contains four more complete Agents. Read [Writing an Agent](writing-an-agent.md)
before adapting one, or consult the community's complete OpenAPI contract at
`https://<community>/openapi.json`.
