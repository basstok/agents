# Basstok Agents

Welcome new Members. Run a poll. Bring a good discussion into view.

Five useful Agents for [Basstok](https://basstok.com/), ready to install in your
community or run yourself. Each is a small external program using the Basstok
REST API with explicit permission.

[Explore Basstok](https://basstok.com/) · [Run an Agent](docs/getting-started.md) · [Browse the code](agents)

## Welcome guide

Give new Members a personal welcome. Write your message once; Welcome guide
sends it from you when someone joins, with the Agent clearly identified.

<p>
  <img src="docs/images/welcome-guide-permissions.png" alt="Write a welcome message and review access before installing Welcome guide" width="240" height="522">
  <img src="docs/images/welcome-guide-message.png" alt="A new Member receives Mara’s welcome, sent by Welcome guide" width="240" height="522">
</p>

Write your greeting → install → new Members receive it. The message field is
available on iPhone, Android, and the web.

[Read the code →](agents/welcome-guide.ts)

## Help desk

Keep a help request moving. Add the **Help request** Label to a post and Help
desk starts a private follow-up with its author.

<p>
  <img src="docs/images/help-desk-reply.png" alt="A Member receives a private follow-up to their help request" width="240" height="522">
  <img src="docs/images/help-desk-permissions.png" alt="Help desk installation shows its selected Content and permissions" width="240" height="522">
</p>

[Read the code →](agents/help-desk.ts)

## Quick polls

Let the community choose. Publish two to four bullet-point choices with the
**Quick poll** Label. Quick polls adds a guide so Members can vote with reactions.

<p>
  <img src="docs/images/quick-polls-voting.png" alt="A dinosaur community votes on its next topic using reactions" width="240" height="522">
  <img src="docs/images/quick-polls-permissions.png" alt="Review Quick polls and the Content it can access before installing" width="240" height="522">
</p>

[Read the code →](agents/quick-polls.ts)

## Discussion closeout

Give a discussion a clear finish. With the **20-comment discussion** Label,
the Agent adds a participation recap and pauses replies after 20 visible Comments.

<p>
  <img src="docs/images/discussion-closeout-recap.png" alt="A completed discussion shows its participation recap and paused replies" width="240" height="522">
  <img src="docs/images/discussion-closeout-permissions.png" alt="Review Discussion closeout before installing it" width="240" height="522">
</p>

[Read the code →](agents/discussion-closeout.ts)

## Community favorites

Make good posts easier to find. Add the **Favorites eligible** Label; after
five reactions, Community favorites features the post.

<p>
  <img src="docs/images/community-favorites-featured.png" alt="A post becomes featured after the community gives it five reactions" width="240" height="522">
  <img src="docs/images/community-favorites-permissions.png" alt="Review Community favorites and its selected Content before installing" width="240" height="522">
</p>

[Read the code →](agents/community-favorites.ts)

## Use them in Basstok

As a Manager, open **Account → Agents** on iPhone or Android, or
**Account → Administration → Agents** on the web. Choose an Agent, review its
permissions, and install. Uninstall it from the same place.

Agents have no access by default. They act within the responsible Member’s
current authority and the resources explicitly granted to them. Uninstalling
stops future actions; it does not undo work already completed.

The screenshots show Basstok for iPhone. Agents also work with Android and the web.

## Make one your own

The five programs in [agents/](agents) are ready to run or adapt. For example,
this is Community favorites:

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

[Get started](docs/getting-started.md) to connect and run one, or
[write your own Agent](docs/writing-an-agent.md). Use TypeScript or any language
that can make ordinary HTTP requests.

Running your own copy? Change the welcome text in
[Welcome guide](agents/welcome-guide.ts), or read your own program’s settings.
The installation screens shown above belong to Basstok’s official Agents;
third-party parameters do not automatically create screens in Basstok.

The [Agent guide](https://agents.basstok.com/) covers connection and hosting.
The shared [Basstok REST API](https://github.com/basstok/api) has its own
reference and OpenAPI contract. Run `npm run check` to build, test, and check
documentation links.

## License

[MIT](LICENSE)
