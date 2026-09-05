import { BasstokClient } from "../src/basstok.js";
import type { WebhookEvent } from "../src/basstok.js";
import {
  CredentialFileLease,
  defaultCredentialsFile,
} from "../src/credentials.js";
import {
  environmentPort,
  optionalEnvironment,
  requiredEnvironment,
} from "../src/environment.js";
import {
  authorizeWithLoopback,
  completeGrantSetup,
  parseAgentScopes,
  revokeToken,
} from "../src/oauth.js";

const basstokUrl = requiredEnvironment("BASSTOK_URL");
const clientId = requiredEnvironment("BASSTOK_CLIENT_ID");
const webhookUrl = requiredEnvironment("BASSTOK_WEBHOOK_URL");
const agentName = optionalEnvironment("BASSTOK_AGENT_NAME") ?? clientId;
const webhookId = optionalEnvironment("BASSTOK_WEBHOOK_ID") ?? clientId;
const webhookEvent = parseWebhookEvent(requiredEnvironment("BASSTOK_WEBHOOK_EVENT"));
const scopes = parseAgentScopes(requiredEnvironment("BASSTOK_SCOPES"), []);
const callbackPort = environmentPort("CALLBACK_PORT", 3001);
const credentialsPath = optionalEnvironment("BASSTOK_CREDENTIALS_FILE") ??
  defaultCredentialsFile;
const lease = await CredentialFileLease.acquire(credentialsPath);
try {
  await lease.writeAuthorizing({ basstokUrl, clientId });
  const tokens = await authorizeWithLoopback(basstokUrl, {
    clientId,
    scopes,
    port: callbackPort,
    onReady: (url, redirectUri) => {
      console.log(`Open this URL to authorize the Agent:\n\n${url}`);
      console.log(`\nWaiting for the callback at ${redirectUri}`);
    },
  });
  await completeGrantSetup(async () => {
    const approvedScopes = new Set(parseAgentScopes(tokens.scope, []));
    if (approvedScopes.size !== scopes.length ||
        !scopes.every((scope) => approvedScopes.has(scope))) {
      throw new Error("OAuth response did not contain the requested scope set");
    }

    const webhook = await new BasstokClient(
      basstokUrl,
      tokens.access_token,
    ).putWebhook(clientId, webhookId, {
      grant_id: tokens.grant_id,
      name: agentName,
      endpoint: webhookUrl,
      events: [webhookEvent],
    });
    await lease.writeAuthorized({
      basstokUrl,
      clientId,
      tokens,
      webhookSecret: webhook.signing_secret,
    });
  }, () => revokeToken(
    basstokUrl,
    tokens.access_token,
    clientId,
  ));
  console.log(`\nAuthorization complete. Credentials written to ${lease.path}.`);
} finally {
  await lease.release();
}

function parseWebhookEvent(value: string): WebhookEvent {
  if (value === "content.changed" || value === "member.created" || value === "chat.changed") {
    return value;
  }
  throw new Error("BASSTOK_WEBHOOK_EVENT is not a supported event");
}
