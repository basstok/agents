# Writing an Agent

Choose one useful task for your Agent. Connect to your community, then write
an event handler.

## Write the useful behavior

For example, feature selected Content after it receives five reactions.
[Connect](connecting.md) with `content:read` and `moderation:write`, then add:

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

Put your TypeScript file under `agents/`, run `npm run build`, then
`node --env-file-if-exists=.env.local dist/agents/your-agent.js`. Keep one
connection and running Agent per directory. The five supplied
[Agents](https://github.com/basstok/agents/tree/main/agents) are complete programs
you can run or adapt.

## Choose one event and narrow permissions

| Handler | Reference | Required read scope |
|---|---|---|
| `onContentChanged(content, api)` | `content.changed` | `content:read` |
| `onMemberCreated(member, api)` | `member.created` | `member:read` |
| `onChatChanged(chat, actorId, api)` | `chat.changed` | `chat:read` |

Choose the event your Agent should respond to when connecting. Your handler
receives the current resource, limited to what your grant may read.

Request only the additional write scopes your handler needs. Community
favorites does not need Content creation, Member, or Chat access. Every grant
has one responsible human Member and cannot exceed that Member's current
authority. Content access also requires Labels explicitly selected on the
grant; setting a Label ID in your program cannot grant that authority.

For `onChatChanged`, pass `actorId` to later Chat reads or mutations when
present. It identifies the explicitly selected controlled Member whose
participation authorized the event. It never grants authority beyond that
participant's current Chat access and admission boundary.

## Keep repeated work safe

Make each action safe to repeat. The same change may be delivered more than
once, including after a restart:

- use current-state checks before task mutations;
- use `deterministicId` for Content, Comment, and Member create routes that
  accept a stable resource ID;
- use `idempotencyKey` for Chat, Message, and Asset creates, keeping both the
  key and request unchanged after an ambiguous result;
- use the returned resource ID for later operations. An idempotency key is
  not a resource ID.

The supplied [Welcome guide](https://github.com/basstok/agents/blob/main/agents/welcome-guide.ts)
demonstrates retry-safe creates. [Discussion closeout](https://github.com/basstok/agents/blob/main/agents/discussion-closeout.ts)
shows a larger ordered operation: commit an exact recap Comment before pausing
replies, then recover from an ambiguous response without replacing someone
else's work.

If your Agent sends an external email, makes a payment, or performs another
action that cannot safely be repeated, keep a durable receipt for that action.

## Respect changes in access

Permissions can change while your Agent is running. Do not assume a resource
will remain readable or writable after an earlier request succeeded.

Let retryable failures propagate so the delivery can be retried. Catch an error
only when your Agent can handle it meaningfully. Use its HTTP status, `code`,
and `retryable` value to decide what to do; a `401` calls for checking or
reconnecting the grant, not requesting more permissions.

## Go deeper when needed

- [Connection setup](connecting.md): registration, selected
  resources, protected credentials, refresh, retries, and hosting.
- [REST API](rest-api.md): exact requests, responses, OAuth, signing, and events.
- [Runnable Agents](https://github.com/basstok/agents/tree/main/agents): choose
  an existing capability to run or adapt.
