import {
  BasstokApiError,
  type BasstokClient,
  type Comment,
  type Content,
} from "../src/basstok.js";
import { isMainModule, requiredEnvironment } from "../src/environment.js";
import { deterministicId } from "../src/ids.js";
import { serveAgentWebhooks } from "../src/webhooks.js";

const commentLimit = 100;
const closeAtVisibleComments = 20;
const maximumCommentScan = 100_000;
const maximumCommentPages = maximumCommentScan / commentLimit;

export async function closeDiscussion(
  content: Content,
  api: BasstokClient,
  closeoutLabelId: string,
): Promise<void> {
  if (!content.labels.some(({ id }) => id === closeoutLabelId)) return;
  if (content.system_labels.includes("hidden") ||
      content.system_labels.includes("needs_review")) return;
  if (content.system_labels.includes("replies_paused")) return;

  const recapId = deterministicId("discussion-closeout/recap", content.id);
  const existing = await api.getCommentIfPresent(content.id, recapId);
  if (existing?.updated_at !== undefined) return;

  if (existing !== undefined) {
    if (!await createOrVerifyRecap(api, content.id, recapId, existing.body)) return;
    await api.pauseReplies(content.id);
    return;
  }

  const visible = await firstVisibleComments(api, content.id, recapId);
  if (visible.length < closeAtVisibleComments) return;
  const body = recap(visible);
  if (!await createOrVerifyRecap(api, content.id, recapId, body)) return;
  await api.pauseReplies(content.id);
}

async function createOrVerifyRecap(
  api: BasstokClient,
  contentId: string,
  recapId: string,
  body: string,
): Promise<boolean> {
  try {
    const stored = await api.createComment(contentId, recapId, { body });
    if (!("body" in stored) || stored.id !== recapId || stored.body !== body ||
        stored.updated_at !== undefined) return false;
  } catch (error) {
    if (error instanceof BasstokApiError && error.status === 409 && !error.retryable) {
      return false;
    }
    throw error;
  }
  return true;
}

async function firstVisibleComments(
  api: BasstokClient,
  contentId: string,
  excludedId: string,
): Promise<Comment[]> {
  const seen = new Set<string>();
  const suppressed = new Set<string>();
  const visible: Comment[] = [];
  let offset = 0;

  for (let pageNumber = 0; pageNumber < maximumCommentPages; pageNumber += 1) {
    const page = await api.listComments(contentId, {
      offset,
      limit: commentLimit,
      order: "oldest",
    });
    if (page.items.length > commentLimit) {
      throw new Error("Comment response exceeds the requested page bound");
    }
    for (const comment of page.items) {
      if (seen.has(comment.id)) {
        throw new Error("Comment response has duplicate IDs");
      }
      const suppressedParent = comment.parent_id !== undefined &&
        suppressed.has(comment.parent_id);
      seen.add(comment.id);
      if (comment.id === excludedId || suppressedParent ||
          comment.system_labels.includes("hidden") ||
          comment.system_labels.includes("needs_review")) {
        suppressed.add(comment.id);
      } else {
        visible.push(comment);
        if (visible.length === closeAtVisibleComments) return visible;
      }
    }

    if (page.next_offset === undefined) return visible;
    if (!Number.isSafeInteger(page.next_offset) || page.next_offset <= offset) {
      throw new Error("Comment pagination did not advance");
    }
    if (page.next_offset > maximumCommentScan) {
      throw new Error("Comment pagination exceeds the public scan bound");
    }
    offset = page.next_offset;

    if (pageNumber + 1 === maximumCommentPages) {
      throw new Error("Comment pagination exceeds the public page bound");
    }
  }
  return visible;
}

function recap(comments: Comment[]): string {
  const authors = new Set(comments.map(({ authorship }) =>
    authorship.member_id === undefined
      ? `name:${authorship.display_name ?? "unattributed"}`
      : `member:${authorship.member_id}`
  ));
  const people = `${authors.size} ${authors.size === 1 ? "participant" : "participants"}`;
  return `**Discussion closeout**\n\nThis discussion reached 20 visible comments from ${people}.`;
}

if (isMainModule(import.meta.url)) {
  const labelId = requiredEnvironment("BASSTOK_CLOSEOUT_LABEL_ID");
  await serveAgentWebhooks({
    name: "Discussion closeout",
    onContentChanged: (content, api) => closeDiscussion(content, api, labelId),
  });
}
