import type { BasstokClient, Content } from "../src/basstok.js";
import { isMainModule, requiredEnvironment } from "../src/environment.js";
import { serveAgent } from "../src/webhooks.js";

export function reactionThreshold(value = "5"): number {
  const count = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(count)) {
    throw new Error("BASSTOK_FAVORITES_REACTIONS must be a positive safe integer");
  }
  return count;
}

export async function featureCommunityFavorite(
  content: Content,
  api: BasstokClient,
  favoritesLabelId: string,
  featureAt = 5,
): Promise<void> {
  if (!Number.isSafeInteger(featureAt) || featureAt < 1) {
    throw new Error("Reaction threshold must be a positive safe integer");
  }
  const selected = content.labels.some(({ id }) => id === favoritesLabelId);
  if (!selected || content.system_labels.includes("featured")) return;

  const reactions = await api.getReactionSummary(content.id);
  if (reactions.total_count >= featureAt) await api.setFeatured(content.id, true);
}

if (isMainModule(import.meta.url)) {
  const labelId = requiredEnvironment("BASSTOK_FAVORITES_LABEL_ID");
  const featureAt = reactionThreshold(process.env.BASSTOK_FAVORITES_REACTIONS);
  await serveAgent({
    name: "Community favorites",
    onContentChanged: (content, api) => featureCommunityFavorite(content, api, labelId, featureAt),
  });
}
