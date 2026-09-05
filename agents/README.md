# Runnable Agents

Choose an Agent to run or adapt. [Get started](../docs/getting-started.md),
then use its start command:

| Agent | Start command | Label setting |
|---|---|---|
| [Welcome guide](welcome-guide.ts) | `npm run start:welcome` | none |
| [Help desk](help-desk.ts) | `npm run start:help-desk` | `BASSTOK_HELP_LABEL_ID` |
| [Quick polls](quick-polls.ts) | `npm run start:polls` | `BASSTOK_POLL_LABEL_ID` |
| [Discussion closeout](discussion-closeout.ts) | `npm run start:closeout` | `BASSTOK_CLOSEOUT_LABEL_ID` |
| [Community favorites](community-favorites.ts) | `npm run start:favorites` | `BASSTOK_FAVORITES_LABEL_ID` |

For example, select Quick polls with:

```sh
npm run connect -- https://community.example --agent quick-polls
```

Use the [command name](../docs/official-agents.md#run-your-own-copy) of the Agent
you chose. Stop a running Agent before reconnecting.

For Content Agents, [select the Label on your grant](../docs/connecting.md#select-content-resources)
and put its ID in `.env.local` using the setting above. Welcome guide needs no
Label or `.env.local` file.

Keep one working directory and process per connection. Do not share the private
connection files. See [Connection setup](../docs/connecting.md) for hosting and
recovery, and [Official Agents](../docs/official-agents.md) for behavior and permissions.
