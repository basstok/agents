# Runnable Agents

These are complete external Basstok Agents, not pseudocode. Build once with
`npm run build`, [connect your registered application](../docs/getting-started.md),
then start one Agent. No manual token or webhook setup is needed:

| Agent | Command | Event | Additional environment |
|---|---|---|---|
| Welcome guide | `npm run start:welcome` | `member.created` | none |
| Help desk | `npm run start:help-desk` | `content.changed` | `BASSTOK_HELP_LABEL_ID` |
| Quick polls | `npm run start:polls` | `content.changed` | `BASSTOK_POLL_LABEL_ID` |
| Discussion closeout | `npm run start:closeout` | `content.changed` | `BASSTOK_CLOSEOUT_LABEL_ID` |
| Community favorites | `npm run start:favorites` | `content.changed` | `BASSTOK_FAVORITES_LABEL_ID` |

For example, select Quick polls with:

```sh
npm run connect -- https://community.example --agent quick-polls
```

The connection command requests only that Agent's permissions and registers its
event. The other names are `welcome-guide`, `help-desk`, `discussion-closeout`,
and `community-favorites`. Stop a running Agent before reconnecting.

Keep one working directory per connection. The owner-only connection and
credential files are ignored by Git; do not share them or run two processes
against the same credential file. The bundled file store supports Linux and
macOS. See [Connection setup](../docs/connecting.md) for options and recovery.

The Content Agents need their ordinary Label selected on the OAuth grant as
well as the matching Label ID in `.env.local` or their service environment. See
[Getting started](../docs/getting-started.md) and
[Official Agents](../docs/official-agents.md).
