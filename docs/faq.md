# FAQ

## What is a Basstok Agent?

An external program that does something useful for a community through the
Basstok REST API. For instance, it can welcome Members or run a poll.

## Where does it run?

Outside Basstok, on a host you operate. It needs HTTPS access to your community
and a public HTTPS endpoint to receive webhooks.

## How do I connect?

[Register an application](connecting.md#register-an-application), run
`npm run connect -- https://community.example`, and approve its permissions
in your browser. Then start the Agent. [Getting started](getting-started.md)
walks through a complete setup.

## What can an Agent access?

Nothing by default. Each grant has one responsible human Member and cannot
exceed that Member's current authority. It also needs the relevant scopes and
permission for each resource. Content access requires explicitly selected
Labels. Revoking a grant or resource selection removes future access.

## Can it read private Chats?

Only with `chat:read`, through a Member participating in that exact Chat: the
responsible Member, or a controlled Member explicitly selected for the request.
This is not community-wide access. A participant added later cannot read earlier
history. Write permission does not imply read permission.

## Can it create Members or modify Content?

Yes, with the required permissions. Creating no-login Members requires
`member:write` and a responsible Member with Manager authority. Their
Agent-created origin remains visible, and creating them grants no extra authority.
Content mutations require the appropriate scope and selected Labels.

## What about attachments?

Attachments require the same access as the Content or Chat they belong to.
Knowing an Asset ID does not grant access.

## Can I remove an Agent?

Yes. Revoke its grant, or uninstall an official Agent on the **Agents** page.
This stops future access; it does not undo completed work.

## What happens if it goes offline?

Basstok remains usable. When the Agent returns, use current resource state
rather than assuming every change was delivered. Make actions safe to repeat.

## Does pausing activity notifications stop Agents?

No. That setting pauses Member notifications, activity email and push, not
Agent webhooks or actions. Uninstall an Agent or revoke its grant to stop it.

## How do I reconnect?

Stop the Agent, run `npm run connect`, approve again, and restart. Keep the
same application ID and select Content Labels again on the new grant if needed.
See [Connection setup](connecting.md#credentials-and-reconnecting) if a credential
refresh was interrupted.

## Do I have to use TypeScript?

No. Use any language that supports the public REST, OAuth, and webhook
contracts. The supplied TypeScript programs run on Linux or macOS; their
credential-file storage is not supported on Windows.

## How are official Agents different?

Basstok maintains the [official catalog](official-agents.md). Other Agents are
maintained by their developers. Both use the same public API and permissions.

## Where is the API reference?

Read the [Basstok REST API](https://github.com/basstok/api). Your community also serves its complete
OpenAPI document at `/openapi.json`.
