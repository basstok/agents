# Contributing

Keep contributions focused on the public Basstok REST API and external Agent
development.

Before opening a pull request:

```sh
npm ci
npm run check
```

Agents should use standard web protocols, request only the scopes they need,
verify webhook signatures before processing, and avoid logging credentials or
webhook secrets. Use a separate platform-appropriate protected credential store
for each running Agent; the included credential-file helper is POSIX-only.
