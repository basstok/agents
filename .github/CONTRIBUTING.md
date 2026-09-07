# Contributing

Keep contributions focused on the public Basstok REST API and external Agent
development.

Use Node.js 24 or newer on Linux or macOS. From the repository root:

```sh
npm ci
npm run check
```

`check` builds the TypeScript, runs tests, builds the documentation site, and
checks local links. Use `npm run docs:dev` to preview the site while editing.

Start with a runnable capability in [agents/](../agents). Shared REST,
connection and webhook code lives in [src/](../src), behavioral tests in
[tests/](../tests), and development commands in [scripts/](../scripts).
The [getting started guide](../docs/getting-started.md) covers connecting to a
real community; the automated tests need no account or credentials.

Agents should use standard web protocols, request only the scopes they need,
verify webhook signatures before processing, and avoid logging credentials or
webhook secrets. Use a separate platform-appropriate protected credential store
for each running Agent; the included credential-file helper is POSIX-only.
