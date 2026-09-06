# Connection setup

Connect once, then run your Agent. Use this page for registration, custom
permissions, hosting, and reconnecting.

## Register an application

An Organization Manager registers your application through the public API.
For Welcome guide:

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

Choose your application's name and only the permissions it needs. Use the
Manager session for registration only; never put it in the Agent's code or
environment. The Agent gets its own grant when a responsible Member approves it.

## Connect

```sh
npm run connect -- https://community.example \
  --agent community-favorites \
  --client-id community-favorites \
  --webhook-url https://agent.example/webhooks/basstok
```

Omit `--client-id` and `--webhook-url` to enter them when prompted.
`--agent` chooses a [supplied Agent's permissions and event](official-agents.md#run-your-own-copy).
Welcome guide is the initial default.

For your own Agent, use `--name "My Agent"`, `--scopes "content:read moderation:write"`,
and `--event content.changed`. Request the read scope corresponding to your event.

Open the printed link in a browser and approve in Basstok. To use the shorter
command name, run `npm link` after building, then `basstok-agent connect`.
This links your local checkout, not a published npm package.

## Select Content resources

Content scopes alone grant no Content access. The responsible Member must
[select ordinary Labels on the grant](https://github.com/basstok/api/blob/main/reference.md#select-resources), using the
grant ID printed by `connect`. That operation uses the human Member's session,
not the Agent's token.

For a supplied Content Agent, also set its Label ID in `.env.local` as described
in [Choose another Agent](getting-started.md#choose-another-agent).
The Label in your code selects what to act on; it cannot grant permission.

## Hosting and ports

Your public HTTPS URL must forward `/webhooks/basstok` to the Agent's listener,
which uses port 3000 by default. For development, use an HTTPS forwarding tool
of your choice. [Webhook destination requirements](https://github.com/basstok/api/blob/main/reference.md#webhook-registration) still apply.

The authorization callback uses `http://127.0.0.1:3001/callback` and must exactly
match your application's registered redirect. Use a browser on that computer.
For a remote host, forward the callback port over your authenticated remote
connection first.

Use `--port` and `--callback-port` to change ports. Run
`node dist/tools/cli.js --help` for all options.

Run your Agent under a process supervisor. `/healthz` reports listener liveness,
not successful automation or current authorization.

## Credentials and reconnecting

Keep one directory and running process per connection. The owner-only files
`.basstok-agent.json` and `.basstok-agent.json.credentials` are ignored by Git.
Do not share, log, or hand-edit them. To choose another location, set
`BASSTOK_CONNECTION_FILE` when connecting and running; the credentials use that
path plus `.credentials`.

To reconnect after revocation or an interrupted credential refresh:

```sh
# Stop the Agent first.
npm run connect
# Approve in Basstok, then restart your Agent.
```

Reuse the same application ID. The same responsible Member can move its webhook
to the fresh grant; the previous grant is revoked and the signing secret rotates.
Select Content Labels again on the new grant when needed.

The supplied credential store requires Linux, macOS, or another POSIX host.
A Windows implementation needs an equivalent secure credential store.

<details>
<summary>Security and retry details</summary>

Connection uses authorization code flow with PKCE S256, fresh state, and an
exact issuer check. The requested and approved scopes must match. Failed setup
attempts revoke the new grant; an unconfirmed revocation is reported.

Refresh tokens are single-use. Before refresh, old replayable credentials are
removed durably; a successful rotation saves the new pair before use. An
ambiguous refresh requires reconnecting, never replaying the old token. Grant
identity and scopes cannot change during refresh. Files reject symbolic links,
a different owner, or overly broad permissions; concurrent use is rejected.

Deliveries are signature-verified before parsing, checked against their reference
metadata, and deduplicated while active and recently completed. Changes for the
same resource run serially. Each callback receives a current authorized REST
read. Recent deduplication is in memory; keep mutations safe across restarts.

REST requests have a 30-second budget and at most three attempts. Replay-safe
GET, PUT and DELETE requests, and POST creates with an `Idempotency-Key`, can
retry transient transport failures or retryable conflicts, throttling, and
server failures. Backoff includes jitter and respects `Retry-After`. Delays
beyond the budget are returned to the caller, not shortened. Denials and typed
non-retryable conflicts are not retried. One-use OAuth operations are never
replayed automatically. Authenticated requests refuse redirects.

The listener allows 16 connections and two active deliveries. Bodies are limited
to 64 KiB with a 15-second read deadline; admitted handlers may finish later.
JSON responses are bounded at 72 MiB and buffered Assets at 8 MiB. Use bounded
Range requests for larger Assets and avoid unbounded scans in handlers.

</details>
