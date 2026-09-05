import type { BasstokClient, Content } from "../src/basstok.js";
import { isMainModule, requiredEnvironment } from "../src/environment.js";
import { serveAgent } from "../src/webhooks.js";

const featureAt = 5;

export async function featureCommunityFavorite(
  content: Content,
  api: BasstokClient,
  favoritesLabelId: string,
): Promise<void> {
  const selected = content.labels.some(({ id }) => id === favoritesLabelId);
  if (!selected || content.system_labels.includes("featured")) return;

  const reactions = await api.getReactionSummary(content.id);
  if (reactions.total_count >= featureAt) await api.setFeatured(content.id, true);
}

if (isMainModule(import.meta.url)) {
  const labelId = requiredEnvironment("BASSTOK_FAVORITES_LABEL_ID");
  await serveAgent({
    name: "Community favorites",
    onContentChanged: (content, api) => featureCommunityFavorite(content, api, labelId),
  });
}
