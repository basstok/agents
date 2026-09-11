# Getting started

Run Welcome guide to send new Members a direct welcome.

## What you need

- Node.js 24 LTS or newer on Linux or macOS;
- your Basstok community URL and a registered application ID;
- a reachable HTTPS webhook URL ending in `/webhooks/basstok`.

An Organization Manager must first [register the application](connecting.md#register-an-application).
Welcome guide needs only `member:read` and `chat:write`, with the redirect
`http://127.0.0.1:3001/callback`. Your Agent never needs the Manager's session.

## 1. Get the code

```sh
git clone https://github.com/basstok/agents.git my-basstok-agent
cd my-basstok-agent
npm ci
npm run build
```

## 2. Connect

```sh
npm run connect -- https://community.example
```

Enter the registered application ID and webhook URL when prompted. Open the
printed link in a browser on this computer and approve the two permissions in
Basstok.

Keep one working directory per connection. The private connection files are
ignored by Git; don't share them. Welcome guide needs no `.env.local` file.

## 3. Start

```sh
npm start
```

Make your HTTPS webhook URL forward to port 3000. For local development, use
an HTTPS forwarding tool of your choice.

When a new Member joins outside Agent execution, Welcome guide sends a welcome
in a direct Chat from the responsible Member. Repeated deliveries do not
produce duplicate welcomes. [Read the Agent](https://github.com/basstok/agents/blob/main/agents/welcome-guide.ts).

## Choose another Agent

Stop the running Agent, then reconnect with its command name. For Quick polls:

```sh
npm run connect -- https://community.example --agent quick-polls
```

For Content Agents, [select the Label on your grant](connecting.md#select-content-resources)
and put its ID in `.env.local` using the setting below. Welcome guide needs no
Label or `.env.local` file; reconnect with `--agent welcome-guide` and run `npm start`.

<details>
<summary>Start commands and Label settings</summary>

**[Help desk](https://github.com/basstok/agents/blob/main/agents/help-desk.ts)**

Connect with `--agent help-desk`. Set `BASSTOK_HELP_LABEL_ID` and run
`npm run start:help-desk`.

**[Quick polls](https://github.com/basstok/agents/blob/main/agents/quick-polls.ts)**

Connect with `--agent quick-polls`. Set `BASSTOK_POLL_LABEL_ID` and run
`npm run start:polls`.

**[Discussion closeout](https://github.com/basstok/agents/blob/main/agents/discussion-closeout.ts)**

Connect with `--agent discussion-closeout`. Set `BASSTOK_CLOSEOUT_LABEL_ID`
and run `npm run start:closeout`.

**[Community favorites](https://github.com/basstok/agents/blob/main/agents/community-favorites.ts)**

Connect with `--agent community-favorites`. Set `BASSTOK_FAVORITES_LABEL_ID`
and run `npm run start:favorites`.

Optionally set `BASSTOK_FAVORITES_REACTIONS=10` to feature posts after ten
reactions instead of five. Use a positive whole number. This setting applies
to the Agent you run yourself; it does not change the installed official Agent.
Only posts covered by its grant and selected Label are eligible. Changing the
threshold affects subsequent processing; it does not remove existing features
or automatically rescan older posts.

</details>

## Discussion guide

Give selected discussions a useful starting point. For a help Label, for
example, ask people to include what they tried and what happened. For a
critique Label, explain the kind of feedback that helps.

Register an application with `content:read content:write`, then connect:

```sh
npm run connect -- https://community.example --agent discussion-guide
```

[Select its Label on the grant](connecting.md#select-content-resources).
Add these settings to your local `.env.local`, using that Label's ID:

```dotenv
BASSTOK_GUIDE_LABEL_ID=your-label-id
BASSTOK_GUIDE_TEXT="**To help others answer:** include what you tried and what happened."
```

```sh
npm run start:guide
```

On the next change to an eligible post, the Agent adds your text as an
ordinary Comment. It skips hidden posts, posts awaiting review and discussions
with replies paused. This is guidance, not a required form or a moderation rule.

The text supports Markdown, up to 2,048 UTF-8 bytes. It is shared verbatim with
everyone who can read the post; don't include private instructions or credentials.
Restart after changing settings. Existing guide Comments, including human edits,
stay unchanged. Repeated deliveries and restarts reuse the same Comment identity
for that post and Label. Removing and reapplying the Label does not add another
guide, and startup does not scan old posts. A subsequent eligible change can add
the guide to an older post.

Stop the process to stop handling events; revoke its grant to remove future
API access. Already posted Comments remain. Run it yourself using the same
HTTPS webhook setup above; it is not in Basstok's installation catalog.

## Next steps

- [Agent behavior and permissions](official-agents.md).
- [Write your own handler](writing-an-agent.md).
- [Connection options and recovery](connecting.md) cover custom permissions,
  resource selection, remote hosts, and reconnecting.

To reconnect, stop the Agent, run `npm run connect`, approve again, and restart.
Content Agents need their Labels selected again on the new grant.
