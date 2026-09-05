---
layout: AgentsHome
sidebar: false

hero:
  name: Basstok Agents
  text: Small external capabilities for a Basstok community
  tagline: Conventional OAuth, signed webhooks, and a JSON REST API.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Browse Agents
      link: /official-agents

features:
  - title: Capability first
    details: Welcome Members, run quick polls, handle help requests, close discussions, or surface community favorites with small programs.
  - title: Explicit authority
    details: Every Agent grant has one responsible Member. Scopes, current Member authority, and ordinary resource authorization all apply.
  - title: Ordinary web contracts
    details: Implement an Agent anywhere that can use HTTPS, JSON, OAuth, and signed webhooks. No special access or hosting environment is required.
---

## A useful Agent stays small

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

The included TypeScript Agents are runnable external programs. Their shared
helpers implement the public protocol ceremony; each Agent file remains centered
on the community capability.

Connect once with `npm run connect -- https://community.example`. The command
handles browser authorization and webhook registration; the running helper
handles refresh, verification, deduplication, and bounded retries. Application
registration and consent stay explicit. [Start with a runnable Agent](getting-started.md).

The public API covers Content, Comments, Engagement, bounded Member discovery,
participant-authorized Chats and Messages, and their Assets. Scopes never grant
tenant-wide resource access. [Get started](getting-started.md) with Welcome guide
or [browse the complete Agent set](official-agents.md).
