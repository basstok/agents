# Connection setup and operation

The normal path is `npm run connect -- https://community.example`, then start
your Agent. This page covers the explicit prerequisites and the protocol
details handled by the shared helpers.

## Register an application

An Organization Manager registers an application through the public API using
a human Member session. For Welcome guide:

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

Use your application's name and only the scopes it needs. Application
registration is a Manager action, not an authority the connection helper can
give itself. Never put the Manager session in the Agent's environment or code.
The Agent runs with the separate, bounded OAuth grant approved by its
responsible Member.

The callback URI must exactly match registration. The helper listens only on
`127.0.0.1`; use a browser on the same computer. If connecting on a remote host,
forward that callback port over your authenticated remote connection first, or
run connection setup on the host with your browser. Keep credentials private
when moving a stopped Agent to another host.

## Connect a supplied Agent

```sh
npm run connect -- https://community.example \
  --agent community-favorites \
  --client-id community-favorites \
  --webhook-url https://agent.example/webhooks/basstok
```

`--agent` selects the supplied capability's scopes and event. It does not change
Basstok or install code remotely. Welcome guide is the initial default.

| Agent name | Event | Requested scopes |
|---|---|---|
| `welcome-guide` | `member.created` | `member:read chat:write` |
| `help-desk` | `content.changed` | `content:read chat:write` |
| `quick-polls` | `content.changed` | `content:read content:write` |
| `discussion-closeout` | `content.changed` | `content:read content:write moderation:write` |
| `community-favorites` | `content.changed` | `content:read moderation:write` |

For your own Agent, specify `--scopes "content:read moderation:write"` and
`--event content.changed` instead; `--name "My Agent"` sets its display name.
The selected event must have its corresponding
read scope. Run `node dist/tools/cli.js --help` for all options, including the
callback and listener ports. After `npm link`, the same help is available as
`basstok-agent --help`.

## Select Content resources

Content scopes alone grant no Content access. The responsible Member must
select ordinary Labels on the new grant using
[`PUT /api/v1/application-grants/{grantId}/resources`](rest-api.md#select-resources).
Use the grant ID printed by the connection command. This is a
human Member-session operation, never an Agent-token operation.

For a supplied Content Agent, set its matching Label ID in `.env.local` as
described in [Runnable Agents](https://github.com/basstok/agents/tree/main/agents).
That value expresses the capability's intent. It cannot grant access.

## What the helpers own

The connection command generates fresh PKCE S256 and state values, presents the
Basstok authorization link, validates callback state and issuer, exchanges the
code, registers a signed webhook, and saves the resulting credentials. The
requested and approved scope sets must match. Failed setup attempts revoke the
new grant; an unconfirmed revocation is reported as an error.

The running `serveAgent` helper owns:

- early, single-flight refresh and atomic persistence of each rotated token pair;
- a bounded HTTP listener with `/healthz` and `/webhooks/basstok`;
- verification of the exact signed webhook bytes and reference metadata;
- active and recent delivery deduplication, with same-resource serialization;
- current authorized REST reads before invoking your callback;
- bounded retries of replay-safe REST requests.

Deduplication is bounded and in memory, not an exactly-once promise. Keep create
keys stable and use current-state checks, as the supplied Agents do. If your
Agent performs a non-idempotent action outside Basstok, persist its receipt in
your own operational store.

## Credentials and reconnecting

The default files are `.basstok-agent.json` (connection choices) and
`.basstok-agent.json.credentials` (OAuth credentials and webhook secret). Both
are owner-only, local Agent operational files, not community data. Keep them,
their temporary files, and any copies out of Git and logs. To choose another
location, set `BASSTOK_CONNECTION_FILE` consistently for connection and serving;
the credential filename is that path plus `.credentials`.

One process may own a credential file at a time. The helper verifies owner-only
POSIX permissions and rejects symbolic links and a different file owner. The
bundled file store does not run on Windows, where Node.js cannot verify an
owner-only ACL. The REST API is platform-independent; a Windows implementation
needs an equivalent secure credential store.

Before attempting a single-use refresh, the helper durably removes the old
replayable credentials. A successful refresh saves the new pair before using
it. A refresh cannot change the grant identity or approved scopes. An
interrupted or ambiguous refresh requires reconnecting, not replaying the old
refresh token:

```sh
# Stop the Agent first.
npm run connect
# Approve in Basstok, then restart your Agent.
```

The command reuses the application ID as the stable webhook ID. For the same
responsible Member, a successful registration moves that subscription to the
new grant, rotates its secret, and revokes the previous grant. An exact retry
recovers the committed secret. Another Member or application cannot take over
the subscription. Select Content Labels again on the new grant when needed.

## Retries and service operation

REST requests have a 30-second budget and at most three attempts. Replay-safe
GET, PUT and DELETE requests, and POST creates carrying an `Idempotency-Key`,
can retry transient transport failures or retryable conflict, throttling, and
server responses. Backoff includes jitter and respects `Retry-After`. A delay
longer than the remaining budget is returned to the caller, not shortened.
Authentication/authorization denials and typed non-retryable conflicts are not
retried. One-use OAuth exchanges and refreshes are never automatically replayed.
Authenticated requests refuse redirects.

The listener admits at most 16 connections and two distinct active deliveries;
request bodies are limited to 64 KiB with a 15-second read deadline. An admitted
handler may finish after that read deadline. REST JSON responses are bounded at
72 MiB and buffered Assets at 8 MiB; use bounded Range requests for larger
Assets. Do not turn a handler into an unbounded scan.

Run the Agent under an ordinary process supervisor, expose its webhook through
HTTPS, and monitor `/healthz`. That endpoint reports listener liveness, not a
promise of current authorization or successful automation. Basstok remains
usable when an external Agent is stopped. Webhooks are change signals, not a
complete history; recovery should use current authorized REST state.
