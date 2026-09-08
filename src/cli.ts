#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  connectAgent, defaultConnectionFile, readConnection, validateConnection,
} from "./connection.js";
import { parseAgentScopes } from "./oauth.js";
import { normalizeBasstokOrigin } from "./origin.js";

const agents = {
  "welcome-guide": { name: "Welcome guide", event: "member.created", scopes: "member:read chat:write" },
  "help-desk": { name: "Help desk", event: "content.changed", scopes: "content:read chat:write" },
  "quick-polls": { name: "Quick polls", event: "content.changed", scopes: "content:read content:write" },
  "discussion-closeout": {
    name: "Discussion closeout", event: "content.changed",
    scopes: "content:read content:write moderation:write",
  },
  "community-favorites": {
    name: "Community favorites", event: "content.changed", scopes: "content:read moderation:write",
  },
} as const;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      agent: { type: "string" }, name: { type: "string" }, "client-id": { type: "string" },
      "webhook-url": { type: "string" }, scopes: { type: "string" }, event: { type: "string" },
      "callback-port": { type: "string" }, port: { type: "string" },
    },
  });
  if (values.help) {
    console.log(`Usage: basstok-agent connect [community-url] [options]

Connect a registered application. Open the printed link and approve in Basstok.
Run this command again, with the Agent stopped, to reconnect.

  --agent <name>          ${Object.keys(agents).join(", ")}
  --name <name>           Human-readable name for your own Agent
  --client-id <id>        Registered OAuth application ID (prompted on first use)
  --webhook-url <url>     Reachable HTTPS URL ending in /webhooks/basstok (prompted)
  --scopes "scope ..."    Explicit permissions for your own Agent
  --event <event>         content.changed, member.created or chat.changed
  --callback-port <port>  Registered local callback port (default 3001)
  --port <port>           Webhook listener port (default 3000)

Setup: https://github.com/basstok/agents/blob/main/docs/connecting.md
Connection files are local, owner-only, and must stay out of Git.`);
    return;
  }
  if (positionals[0] !== "connect" || positionals.length > 2) {
    throw new Error("Use basstok-agent connect [community-url], or --help");
  }
  const path = process.env.BASSTOK_CONNECTION_FILE ?? defaultConnectionFile;
  let previous;
  try { previous = await readConnection(path); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const configuredOrigin = positionals[1] ?? previous?.origin;
  if (configuredOrigin === undefined) throw new Error("Provide the community HTTPS URL on first connection");
  const origin = normalizeBasstokOrigin(configuredOrigin);
  if (previous !== undefined && previous.origin !== origin) {
    throw new Error("This directory is connected to another community. Use a separate directory");
  }
  const custom = values.scopes !== undefined || values.event !== undefined;
  const selected = values.agent ?? (previous === undefined && !custom ? "welcome-guide" : undefined);
  if (selected !== undefined && !Object.hasOwn(agents, selected)) throw new Error("Unknown Agent; use --help");
  const preset = selected === undefined ? undefined : agents[selected as keyof typeof agents];
  const prompt = async (label: string, value: string | undefined): Promise<string> => {
    if (value !== undefined) return value;
    if (!process.stdin.isTTY) throw new Error(`${label} is required; supply it with a command option`);
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await input.question(`${label}: `)).trim(); }
    finally { input.close(); }
  };
  const connection = validateConnection({
    version: 1, origin,
    clientId: await prompt("Application ID (--client-id)", values["client-id"] ?? previous?.clientId),
    webhookUrl: await prompt("Webhook HTTPS URL (--webhook-url)", values["webhook-url"] ?? previous?.webhookUrl),
    name: values.name ?? preset?.name ?? previous?.name ?? "My Agent",
    scopes: parseAgentScopes(values.scopes ?? preset?.scopes ?? previous?.scopes.join(" "), []),
    event: values.event ?? preset?.event ?? previous?.event,
    callbackPort: Number(values["callback-port"] ?? previous?.callbackPort ?? 3001),
    port: Number(values.port ?? previous?.port ?? 3000),
  });
  console.log(`Connecting ${connection.name} to ${origin}`);
  console.log(`Permissions: ${connection.scopes.join(", ")}`);
  console.log(`Registered redirect must be http://127.0.0.1:${connection.callbackPort}/callback`);
  const grantId = await connectAgent(connection, {
    path,
    onReady: (url) => console.log(`\nOpen in a browser on this computer:\n\n${url}\n`),
  });
  console.log("Connected. Start your Agent. Stop it before running connect again.");
  console.log(`Grant ID: ${grantId}`);
  if (connection.scopes.some((scope) => scope.startsWith("content:") || scope === "moderation:write")) {
    console.log("Content access also requires Labels selected by the responsible Member. See /connecting in the docs.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Connection failed");
  process.exitCode = 1;
});
