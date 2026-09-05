# Getting started

Run Welcome guide: when a Member joins, it reads the Member and sends a direct
welcome. The connection command handles authorization and webhook setup; the
Agent file contains the useful behavior.

## What you need

- Node.js 24 LTS or newer on Linux or macOS;
- your Basstok community URL and a registered application ID;
- a reachable HTTPS webhook URL ending in `/webhooks/basstok`.

An Organization Manager must first [register the application](connecting.md#register-an-application).
Welcome guide needs only `member:read` and `chat:write`, with the redirect
`http://127.0.0.1:3001/callback`. Your Agent never needs the Manager's session.

For local development, forward your own HTTPS endpoint to port 3000 with a
forwarding tool of your choice. The command does not provision hosting or a
tunnel.

## 1. Get the code

```sh
git clone https://github.com/basstok/agents.git my-basstok-agent
cd my-basstok-agent
npm ci
npm run build
```

There are no runtime package dependencies.

## 2. Connect

```sh
npm run connect -- https://community.example
```

Enter the registered application ID and webhook URL when prompted. Open the
printed link in a browser on this computer and approve the two permissions in
Basstok. The command handles the local callback, obtains the credentials, and
registers the webhook. It does not print secrets.

Connection and credential files are owner-only and ignored by Git. Use one
working directory per Agent connection. No `.env.local` is needed for Welcome
guide.

Prefer the shorter command name? Run `npm link` once after building, then use
`basstok-agent connect https://community.example`. This links the local checkout;
it does not install a published npm package.

## 3. Start

```sh
npm start
```

Welcome guide now listens on port 3000. When a new Member joins outside Agent
execution, it sends a welcome in a direct Chat from the responsible Member.
The [complete Agent](https://github.com/basstok/agents/blob/main/agents/welcome-guide.ts)
uses stable create keys so repeated deliveries do not produce duplicate welcomes.

The shared helper handles token refresh, signed delivery verification,
deduplication, current-state reads, and bounded REST retries. It does not grant
permissions or turn an Agent into a privileged client.

## Next steps

- [Choose another Agent](https://github.com/basstok/agents/tree/main/agents).
  `connect --agent community-favorites`, for instance, selects that capability's
  minimal permissions. Content Agents also need explicit Label selection.
- [Write your own handler](writing-an-agent.md).
- [Connection options and recovery](connecting.md) cover custom permissions,
  resource selection, remote hosts, and reconnecting.
- [REST API](rest-api.md) documents the underlying public contracts.

To reconnect, stop the running Agent, run `npm run connect`, approve again, and
restart. The command remembers the previous connection. Changing the grant does
not silently add permissions or preserve its previous Content Label selection.
