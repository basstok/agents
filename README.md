# Basstok Agents

Welcome new Members. Run a poll. Bring a good discussion into view.

Five useful Agents for [Basstok](https://basstok.com/), ready to install in your
community or run yourself. Each is a small external program using the Basstok
REST API with explicit permission.

[See the Agents](#the-agents) · [Browse the code](agents) · [Developer guide](https://agents.basstok.com/)

## Run an Agent

With Node.js 24+ on Linux or macOS, a
[registered application](docs/connecting.md#register-an-application), and a
reachable HTTPS webhook URL, start Welcome guide:

```sh
git clone https://github.com/basstok/agents.git
cd agents
npm ci
npm run build
npm run connect -- https://community.example
npm start
```

Use your community URL, enter the application ID and webhook URL, and approve
access in your browser. Forward webhooks to port 3000.
[Full setup and other Agents →](docs/getting-started.md)

Or install in Basstok: as a Manager, open **Account → Agents** on
iPhone or Android, or **Account → Administration → Agents** on the web.
Choose an Agent and review its permissions. Uninstall from the same place.

## The Agents

### Welcome guide

Write your welcome once. New Members receive it from you, with the Agent
clearly identified.

<p>
  <img src="docs/images/welcome-guide-permissions.png" alt="Write a welcome message and review access before installing Welcome guide" width="240" height="522">
  <img src="docs/images/welcome-guide-message.png" alt="A new Member receives Mara’s welcome, sent by Welcome guide" width="240" height="522">
</p>

[Read the code →](agents/welcome-guide.ts)

### Help desk

Keep a help request moving. Add the **Help request** Label to a post and Help
desk starts a private follow-up with its author.

<p>
  <img src="docs/images/help-desk-reply.png" alt="A Member receives a private follow-up to their help request" width="240" height="522">
  <img src="docs/images/help-desk-permissions.png" alt="Help desk installation shows its selected Content and permissions" width="240" height="522">
</p>

[Read the code →](agents/help-desk.ts)

### Quick polls

Let the community choose. Publish two to four bullet-point choices with the
**Quick poll** Label. Quick polls adds a guide so Members can vote with reactions.

<p>
  <img src="docs/images/quick-polls-voting.png" alt="A dinosaur community votes on its next topic using reactions" width="240" height="522">
  <img src="docs/images/quick-polls-permissions.png" alt="Review Quick polls and the Content it can access before installing" width="240" height="522">
</p>

[Read the code →](agents/quick-polls.ts)

### Discussion closeout

Give a discussion a clear finish. With the **20-comment discussion** Label,
the Agent adds a participation recap and pauses replies after 20 visible Comments.

<p>
  <img src="docs/images/discussion-closeout-recap.png" alt="A completed discussion shows its participation recap and paused replies" width="240" height="522">
  <img src="docs/images/discussion-closeout-permissions.png" alt="Review Discussion closeout before installing it" width="240" height="522">
</p>

[Read the code →](agents/discussion-closeout.ts)

### Community favorites

Make good posts easier to find. Add the **Favorites eligible** Label; after
five reactions, Community favorites features the post.

<p>
  <img src="docs/images/community-favorites-featured.png" alt="A post becomes featured after the community gives it five reactions" width="240" height="522">
  <img src="docs/images/community-favorites-permissions.png" alt="Review Community favorites and its selected Content before installing" width="240" height="522">
</p>

[Read the code →](agents/community-favorites.ts)

## Make one your own

Adapt the programs in [agents/](agents). Community favorites:

```ts
import { requiredEnvironment } from "../src/environment.js";
import { serveAgent } from "../src/webhooks.js";

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

[Write your own Agent](docs/writing-an-agent.md) using TypeScript or any
language that can make ordinary HTTP requests.

For your own welcome text, edit [Welcome guide](agents/welcome-guide.ts).
Basstok’s installation screens apply to the official catalog; third-party
Agents provide their own settings.

## Access stays explicit

Agents have no access by default. They act within the responsible Member’s
current authority and the resources explicitly granted to them. Uninstalling
stops future actions; it does not undo work already completed.

The screenshots show Basstok for iPhone. Agents also work with Android and the web.

[REST API](https://github.com/basstok/api) · [Contributing](.github/CONTRIBUTING.md)
· [Security](.github/SECURITY.md) · [MIT license](LICENSE)
