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

## Next steps

- [Choose another Agent](official-agents.md).
- [Write your own handler](writing-an-agent.md).
- [Connection options and recovery](connecting.md) cover custom permissions,
  resource selection, remote hosts, and reconnecting.

To reconnect, stop the Agent, run `npm run connect`, approve again, and restart.
Content Agents need their Labels selected again on the new grant.
