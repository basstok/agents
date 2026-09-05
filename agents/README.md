# Runnable Agents

These are complete external Basstok Agents, not pseudocode. Build once with
`npm run build`, configure `.env.local` (or inject the same environment from
your service manager), then start one Agent:

| Agent | Command | Event | Additional environment |
|---|---|---|---|
| Welcome guide | `npm run start:welcome` | `member.created` | none |
| Help desk | `npm run start:help-desk` | `content.changed` | `BASSTOK_HELP_LABEL_ID` |
| Quick polls | `npm run start:polls` | `content.changed` | `BASSTOK_POLL_LABEL_ID` |
| Discussion closeout | `npm run start:closeout` | `content.changed` | `BASSTOK_CLOSEOUT_LABEL_ID` |
| Community favorites | `npm run start:favorites` | `content.changed` | `BASSTOK_FAVORITES_LABEL_ID` |

Set `BASSTOK_CLIENT_ID`, `BASSTOK_SCOPES`, `BASSTOK_WEBHOOK_ID`, and
`BASSTOK_WEBHOOK_EVENT` for the selected Agent before running
`npm run authorize`. The command stores the short-lived access token, rotating
refresh token, and webhook signing secret in the protected file named by
`BASSTOK_CREDENTIALS_FILE`. Do not commit or share that file. Run one Agent
process per credential file. This bundled credential-file runtime requires a
POSIX host and filesystem and refuses to run on Windows; use an equivalent
platform-secure credential store for a Windows implementation.

`BASSTOK_AGENT_NAME` is an optional human-readable name for the webhook
subscription; it defaults to `BASSTOK_CLIENT_ID` during authorization.

The Content Agents need their ordinary Label selected on the OAuth grant as
well as the matching Label ID in the environment. See
[Getting started](../docs/getting-started.md) and
[Official Agents](../docs/official-agents.md).
