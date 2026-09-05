---
layout: AgentsHome
sidebar: false

hero:
  name: Basstok Agents
  text: Useful tools for your community
  tagline: Welcome Members. Run polls. Bring good discussions into view.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Browse Agents
      link: /official-agents

features:
  - title: Start with something useful
    details: Run one of five ready-to-use Agents, or write your own event handler.
  - title: Choose what it can access
    details: Grant only the permissions and resources it needs. Revoke access at any time.
  - title: Run it outside Basstok
    details: Agents are ordinary programs using the Basstok REST API. Use TypeScript or another language you know.
---

## A useful Agent stays small

Feature selected Content after five reactions:

```ts
await serveAgent({
  name: "Community favorites",
  onContentChanged: async (content, api) => {
    if (content.labels.some(({ id }) => id === favoritesLabelId) &&
        !content.system_labels.includes("featured") &&
        (await api.getReactionSummary(content.id)).total_count >= 5) {
      await api.setFeatured(content.id, true);
    }
  },
});
```

[Get started](getting-started.md) with Welcome guide, or
[choose another Agent](official-agents.md). Every Agent needs explicit
permission and acts within its responsible Member's current access.
