import type { BasstokClient, Member } from "../src/basstok.js";
import { isMainModule } from "../src/environment.js";
import { idempotencyKey } from "../src/ids.js";
import { serveAgentWebhooks } from "../src/webhooks.js";

const welcome =
  "Welcome to the community. Reply here if you would like help getting started.";

export async function welcomeMember(
  member: Member,
  api: BasstokClient,
): Promise<void> {
  if (member.attribution !== undefined) return;
  const responsible = await api.getSession();
  if (member.id === responsible.member_id) return;

  await api.sendDirectMessage({
    chatIdempotencyKey: idempotencyKey(
      "welcome-guide/chat",
      responsible.member_id,
      member.id,
    ),
    messageIdempotencyKey: idempotencyKey(
      "welcome-guide/message",
      responsible.member_id,
      member.id,
    ),
    responsibleMemberId: responsible.member_id,
    recipientMemberId: member.id,
    body: welcome,
  });
}

if (isMainModule(import.meta.url)) {
  await serveAgentWebhooks({ name: "Welcome guide", onMemberCreated: welcomeMember });
}
