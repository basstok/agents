# Basstok Agents

A Basstok Agent is an external program that does something useful for a
community: welcome Members, run polls, handle help requests, or feature good
discussions. Agents connect through the Basstok REST API with explicit permission.

## A useful Agent

Feature selected Content once it receives five reactions:

```ts
import { requiredEnvironment } from "./src/environment.js";
import { serveAgent } from "./src/webhooks.js";

const labelId = requiredEnvironment("BASSTOK_FAVORITES_LABEL_ID");

await serveAgent({
  name: "Community favorites",
  onContentChanged: async (content, api) => {
    const selected = content.labels.some(({ id }) => id === labelId);
    if (selected && !content.system_labels.includes("featured")) {
      const reactions = await api.getReactionSummary(content.id);
      if (reactions.total_count >= 5) await api.setFeatured(content.id, true);
    }
  },
});
```

## Included Agents

| Agent | What it does |
|---|---|
| [Welcome guide](agents/welcome-guide.ts) | Sends new Members a direct welcome |
| [Help desk](agents/help-desk.ts) | Opens a private follow-up for labeled help requests |
| [Quick polls](agents/quick-polls.ts) | Turns a short choice list into a reaction guide |
| [Discussion closeout](agents/discussion-closeout.ts) | Adds a recap and pauses replies after 20 visible Comments |
| [Community favorites](agents/community-favorites.ts) | Features selected Content after five reactions |

Run one as it is, or adapt it. [Behavior and permissions](docs/official-agents.md).

## Start here

With a registered application and an HTTPS webhook URL:

```sh
npm ci
npm run build
npm run connect -- https://community.example
npm start
```

Enter your application ID and webhook URL, approve in Basstok, then start.
Welcome guide is the default. Use Node.js 24+ on Linux or macOS; see
[Getting started](docs/getting-started.md) for the one-time registration.

- [Getting started](docs/getting-started.md)
- [Writing an Agent](docs/writing-an-agent.md)
- [Official Agents](docs/official-agents.md)
- [REST API](docs/rest-api.md)
- [FAQ](docs/faq.md)

Run `npm run check` to build, test, and check documentation links. Other languages
can use the same REST API; each community serves OpenAPI at `/openapi.json`.

## Permissions

Agents have no access by default. Each grant belongs to one responsible Member
and cannot exceed that Member's authority. Content requires selected Labels;
Chat access requires participation. Revoking the grant stops future access.

## License

[MIT](LICENSE)
