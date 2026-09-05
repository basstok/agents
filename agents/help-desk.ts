import type { BasstokClient, Content } from "../src/basstok.js";
import { isMainModule, requiredEnvironment } from "../src/environment.js";
import { idempotencyKey } from "../src/ids.js";
import { serveAgent } from "../src/webhooks.js";

export async function acknowledgeHelpRequest(
  content: Content,
  api: BasstokClient,
  helpLabelId: string,
): Promise<void> {
  if (!content.labels.some(({ id }) => id === helpLabelId)) return;

  const authorId = content.authorship.member_id;
  if (authorId === undefined) return;
  const responsible = await api.getSession();
  if (authorId === responsible.member_id) return;

  await api.sendDirectMessage({
    chatIdempotencyKey: idempotencyKey(
      "help-desk/chat",
      responsible.member_id,
      authorId,
    ),
    messageIdempotencyKey: idempotencyKey(
      "help-desk/message",
      responsible.member_id,
      content.id,
    ),
    responsibleMemberId: responsible.member_id,
    recipientMemberId: authorId,
    body: "Thanks for your help request. Reply here so we can follow up with you.",
  });
}

if (isMainModule(import.meta.url)) {
  const labelId = requiredEnvironment("BASSTOK_HELP_LABEL_ID");
  await serveAgent({
    name: "Help desk",
    onContentChanged: (content, api) => acknowledgeHelpRequest(content, api, labelId),
  });
}
