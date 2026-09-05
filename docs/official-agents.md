# Official Agents

Official Agents are Basstok-maintained external capabilities. They use the same
OAuth, REST, and signed-webhook contracts available to any third-party Agent.
Their TypeScript counterparts in [`agents/`](https://github.com/basstok/agents/tree/main/agents)
show the complete customer behavior without private access or special APIs.

## Welcome guide

Welcomes a newly joined Member created outside Agent execution in a direct Chat.

- Reacts to an authorized `member.created` reference.
- Re-reads the Member and the responsible Member's session.
- Ignores the responsible Member and any Member carrying Agent attribution.
- Creates or reuses the direct Chat, then sends one retry-stable welcome
  Message.

Minimum scopes: `member:read chat:write`. It needs no Content Label.

## Help desk

Turns a labeled help request into a private place to continue helping.

- Reacts when Content carries the Agent's **Help request** Label.
- Requires a Member author other than the responsible Member.
- Creates or reuses a direct Chat with that author.
- Sends one retry-stable acknowledgment for that Content.

Minimum scopes: `content:read chat:write`. The **Help request** Label must be
selected on the grant and supplied as `BASSTOK_HELP_LABEL_ID` for the standalone
TypeScript Agent.

## Quick polls

Turns a short choice list into a reaction-based poll without a separate poll
resource.

- Reacts when Content carries the Agent's **Quick poll** Label.
- Accepts a body containing exactly two to four bounded top-level Markdown
  bullet choices and no other nonempty lines.
- Adds one guide Comment mapping the choices, in order, to Like, Love,
  Celebrate, and Insightful reactions on the Content.
- Uses the create-only Comment route, so a foreign identity collision is never
  overwritten.
- Leaves the first guide unchanged if the Content is edited later.

Minimum scopes: `content:read content:write`. The **Quick poll** Label must be
selected on the grant and supplied as `BASSTOK_POLL_LABEL_ID` for the standalone
TypeScript Agent.

## Discussion closeout

Creates a finite discussion format with a small participation snapshot.

- Reacts when Content carries the Agent's **20-comment discussion** Label.
- Reads bounded oldest-first pages until it finds the first 20 currently
  authorized, ordinary-visible Comments or reaches the public 100,000-Comment
  Content bound.
- Carries parent visibility across pages, so a withheld Comment also suppresses
  its reply subtree from the factual count.
- Adds one deterministic participation recap for those first 20 Comments, then
  pauses new replies.
- The deterministic recap identity remains stable for the Content if
  responsibility for the Agent changes. On retry after the recap has
  committed, the unmodified stored recap must pass Basstok's server-confirmed
  exact create owned by the same application and responsible Member before
  any remaining pause is completed.
  This recovery does not rescan or rewrite the snapshot.
- A foreign or edited Comment at the deterministic recap ID is left untouched
  and cannot cause the Agent to pause replies.

Minimum scopes: `content:read content:write moderation:write`. The
**20-comment discussion** Label must be selected on the grant and supplied as
`BASSTOK_CLOSEOUT_LABEL_ID` for the standalone TypeScript Agent.

## Community favorites

Surfaces Content that receives a clear response from the community.

- Reacts when Content carries the Agent's **Favorites eligible** Label.
- Reads the current reaction summary.
- Features the Content once it has at least five reactions.
- Never removes `featured` if the count later falls.

Minimum scopes: `content:read moderation:write`. The **Favorites eligible**
Label must be selected on the grant and supplied as
`BASSTOK_FAVORITES_LABEL_ID` for the standalone TypeScript Agent.

## Enable or disable an official Agent

An authorized Manager opens **Account → Administration → Agents** in Basstok.
The catalog shows each official Agent, its short description, and current
enabled state. The OAuth authorization screen presents its requested scopes
before the Manager approves them.

Enabling an Agent starts its ordinary OAuth authorization. For a Content Agent,
Basstok also uses its ordinary Label as the grant's explicit Content resource
boundary. Newly requested scope is never added silently. Disabling an Agent
revokes future REST actions and webhook delivery; it does not reverse mutations
already committed through the API.

If an official Agent is unavailable, ordinary Basstok use remains available.
Only that external capability stops.
