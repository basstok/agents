import type { BasstokClient, Content } from "../src/basstok.js";
import { isMainModule, requiredEnvironment } from "../src/environment.js";
import { deterministicId } from "../src/ids.js";
import { serveAgent } from "../src/webhooks.js";

/** Add your guidance once per post and selected Label, without editing existing replies. */
export function discussionGuide(labelId: string, body: string) {
  if (labelId.trim() !== labelId || labelId.length === 0 ||
      Buffer.byteLength(labelId, "utf8") > 128 || /[\x00-\x20\x7f]/.test(labelId)) {
    throw new Error("BASSTOK_GUIDE_LABEL_ID must be a Label ID");
  }
  if (body.trim().length === 0 || Buffer.byteLength(body, "utf8") > 2_048 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)) {
    throw new Error("BASSTOK_GUIDE_TEXT must contain Markdown text, up to 2048 UTF-8 bytes");
  }

  return async (content: Content, api: BasstokClient): Promise<void> => {
    if (!content.labels.some(({ id }) => id === labelId) ||
        content.system_labels.some((label) =>
          label === "replies_paused" || label === "hidden" || label === "needs_review")) return;

    const commentId = deterministicId("discussion-guide/comment", content.id, labelId);
    if (await api.getCommentIfPresent(content.id, commentId) !== undefined) return;
    await api.createComment(content.id, commentId, { body });
  };
}

if (isMainModule(import.meta.url)) {
  await serveAgent({
    name: "Discussion guide",
    onContentChanged: discussionGuide(
      requiredEnvironment("BASSTOK_GUIDE_LABEL_ID"),
      requiredEnvironment("BASSTOK_GUIDE_TEXT"),
    ),
  });
}
