# Writing an Agent

Start with one customer capability. The helpers remove connection and delivery
ceremony; your program still makes ordinary HTTPS/JSON calls to Basstok.

## Write the useful behavior

Community favorites is a small product rule: feature selected Content after
five reactions. After [connecting](connecting.md) with `content:read` and
`moderation:write`, its handler is:

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

The connection command registers the selected event. `serveAgent` verifies and
deduplicates the signed delivery, then fetches the referenced resource with
current authorization before calling your handler. The webhook itself contains
no Content or Message body, Member description, or attachment bytes.

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

The client handles bounded retries. Your capability must still identify the
same logical operation across repeated events and restarts:

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

The delivery helper remembers active and recent deliveries, not all historical
events. Stable mutations make a replay after restart safe. An external email,
payment, or other non-idempotent side effect needs its own durable receipt.

## Respect changes in access

If the current-state read returns `403` or `404`, the helper settles the event
without invoking the handler. If authority or the target changes during the
handler, a non-retryable REST rejection also settles the event. Retryable
conflicts, throttling, and server failures that exhaust client retries leave
the delivery unsettled for normal webhook retry.

Do not catch every error and pretend the action succeeded. The API exposes
HTTP status and a typed error with `code`, `message`, and `retryable`. A `401`
requires checking or reconnecting the grant, not asking for more scopes. The
helper already refreshes expiring credentials before requests; it does not
automatically reauthorize revoked access.

## Go deeper when needed

- [Connection setup and operation](connecting.md): registration, selected
  resources, protected credentials, refresh, retries, and hosting.
- [REST API](rest-api.md): exact requests, responses, OAuth, signing, and events.
- [`src/`](https://github.com/basstok/agents/tree/main/src): small shared protocol
  helpers using Node.js facilities and standard `fetch`, with no runtime
  dependencies. Use them directly or implement the public contract in another
  language; there is no required Basstok SDK or runtime.
