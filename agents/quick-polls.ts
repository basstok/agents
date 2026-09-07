import type { BasstokClient, Content } from "../src/basstok.js";
import { isMainModule, requiredEnvironment } from "../src/environment.js";
import { deterministicId } from "../src/ids.js";
import { serveAgent } from "../src/webhooks.js";

const reactions = ["👍", "❤️", "🎉", "💡"] as const;

export async function publishPollGuide(
  content: Content,
  api: BasstokClient,
  pollLabelId: string,
): Promise<void> {
  if (!content.labels.some(({ id }) => id === pollLabelId)) return;

  const guideId = deterministicId("quick-polls/guide", content.id);
  const existing = await api.getCommentIfPresent(content.id, guideId);
  if (existing !== undefined) return;
  if (content.system_labels.includes("replies_paused")) return;

  const choices = parsePollChoices(content.body);
  if (choices === undefined) return;
  const lines = choices.map((choice, index) =>
    `${reactions[index]} — ${escapeMarkdown(choice)}`,
  );
  await api.createComment(content.id, guideId, {
    body: "**Vote with a reaction:**\n\n" + lines.join("  \n"),
  });
}

export function parsePollChoices(body: string): string[] | undefined {
  if (Buffer.byteLength(body, "utf8") > 2_048) return undefined;
  const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2 || lines.length > reactions.length) return undefined;
  const choices: string[] = [];
  for (const line of lines) {
    const match = /^[-*+][ \t]+(.+?)[ \t]*$/.exec(line);
    if (match === null) return undefined;
    const choice = match[1]!.trim();
    if (choice.length === 0 || Buffer.byteLength(choice, "utf8") > 160 ||
        /[\u0000-\u001f\u007f]/.test(choice)) return undefined;
    choices.push(choice);
  }
  if (new Set(choices.map(foldAscii)).size !== choices.length) {
    return undefined;
  }
  return choices;
}

function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>]/g, "\\$&");
}

if (isMainModule(import.meta.url)) {
  const labelId = requiredEnvironment("BASSTOK_POLL_LABEL_ID");
  await serveAgent({
    name: "Quick polls",
    onContentChanged: (content, api) => publishPollGuide(content, api, labelId),
  });
}
