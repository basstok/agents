# Basstok Agents

A Basstok Agent is a small external program that adds an authorized community
capability through the Basstok REST API.

```text
Agent <--- HTTPS / JSON ---> Basstok
```

The Agent protocol works anywhere with ordinary HTTPS access. Agents use OAuth
grants, receive signed webhook references, re-read current authorized
resources, and make normal REST mutations. They have no privileged access to
Basstok.

## A complete useful Agent

```ts
import { requiredEnvironment } from "./src/environment.js";
import { serveAgentWebhooks } from "./src/webhooks.js";

const labelId = requiredEnvironment("BASSTOK_FAVORITES_LABEL_ID");

await serveAgentWebhooks({
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

The shared helper keeps credential rotation, the bounded listener, signature
verification, delivery deduplication, and REST dereference out of the capability
code. It is compact reference code over the documented HTTPS, OAuth, JSON, and
webhook contracts, not a required SDK or proprietary runtime.

## Included Agents

| Agent | Capability | Minimum scopes |
|---|---|---|
| [Welcome guide](agents/welcome-guide.ts) | Welcomes each new Member created outside Agent execution in a direct Chat | `member:read chat:write` |
| [Help desk](agents/help-desk.ts) | Opens a private follow-up for labeled help requests | `content:read chat:write` |
| [Quick polls](agents/quick-polls.ts) | Turns two to four Markdown choices into a reaction guide | `content:read content:write` |
| [Discussion closeout](agents/discussion-closeout.ts) | Closes an opted-in discussion at 20 visible Comments with a bounded recap | `content:read content:write moderation:write` |
| [Community favorites](agents/community-favorites.ts) | Features selected Content after five reactions | `content:read moderation:write` |

Each file is runnable and intentionally keeps the customer capability near the
top. The Agents use stable create identities and current resource state so
duplicate webhook delivery and safe retries converge.

## Start here

- [Getting started](docs/getting-started.md)
- [Writing an Agent](docs/writing-an-agent.md)
- [Official Agents](docs/official-agents.md)
- [Agent REST API](docs/rest-api.md)
- [FAQ](docs/faq.md)

```sh
npm ci
npm run check
```

Use `npm start` for Welcome guide or one of the `start:*` scripts documented in
[`agents/README.md`](agents/README.md). Each Basstok community serves its
complete OpenAPI document at `/openapi.json`.

The included Node.js programs run on a POSIX host, such as Linux or macOS.
Their shared credential helper requires owner-only file permissions and fails
closed on Windows. The Basstok REST API itself has no such platform restriction.

## Authorization

Every Agent grant has exactly one responsible human Member. Effective authority
is always the intersection of the granted scopes, that Member's current
authority, and ordinary resource authorization. Content access is also limited
to the ordinary Labels selected for the grant. Chat access is limited to a
participating Member in that exact Chat. Revocation affects subsequent requests
and webhook delivery.

## License

[MIT](LICENSE)
