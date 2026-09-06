import { setTimeout as delay } from "node:timers/promises";
import { normalizeBasstokOrigin } from "./origin.js";
import { isIdempotencyKey } from "./ids.js";

export type WebhookEvent =
  | "content.changed"
  | "member.created"
  | "chat.changed";

export interface CanonicalReference {
  id: string;
}

export type AudienceSystemLabel =
  | "members_only"
  | "supporters_only"
  | "team_only";
export type ModerationSystemLabel = "needs_review" | "hidden";
export type ContentSystemLabel =
  | AudienceSystemLabel
  | ModerationSystemLabel
  | "replies_paused"
  | "featured";
export type MemberSystemLabel = "supporter" | "team" | "moderator" | "manager";
export type CommentSystemLabel = ModerationSystemLabel;

export type Authorship =
  | { member_id: string; display_name: string }
  | { member_id?: never; display_name: string }
  | { member_id?: never; display_name?: never };

export interface Content {
  id: string;
  title: string;
  body: string;
  labels: CanonicalReference[];
  system_labels: ContentSystemLabel[];
  authorship: Authorship;
  created_at?: string;
  updated_at?: string;
  engagement: { views: number };
  assets: CanonicalReference[];
  attribution?: string;
}

export type ContentMutationResult = Content | CanonicalReference;

export interface ContentSummary {
  id: string;
  title: string;
  excerpt: string;
  labels: CanonicalReference[];
  system_labels: ContentSystemLabel[];
  authorship: Authorship;
  created_at?: string;
  updated_at?: string;
  engagement: { views: number };
  comment_count: number;
  attribution?: string;
}

export interface Principal {
  member_id: string;
}

export interface Member {
  id: string;
  display_name: string;
  description?: string;
  system_labels: MemberSystemLabel[];
  created_at?: string;
  avatar?: CanonicalReference;
  attribution?: string;
}

export type MemberMutationResult = Member | CanonicalReference;

export interface MemberPresentation {
  id: string;
  display_name: string;
}

export interface ResourcePage<T> {
  items: T[];
  next_offset?: number;
}

export interface Message {
  id: string;
  body: string;
  member_id: string;
  created_at?: string;
  updated_at?: string;
  assets: CanonicalReference[];
  attribution?: string;
}

export interface Chat {
  id: string;
  title?: string;
  participants: CanonicalReference[];
  created_by_member_id?: string;
  created_at?: string;
  assets: CanonicalReference[];
  attribution?: string;
  participant_members: MemberPresentation[];
  latest_message?: Message;
}

export interface Comment {
  id: string;
  body: string;
  system_labels: CommentSystemLabel[];
  parent_id?: string;
  authorship: Authorship;
  created_at?: string;
  updated_at?: string;
  assets: CanonicalReference[];
  attribution?: string;
}

export type CommentMutationResult = Comment | CanonicalReference;

export interface Asset {
  id: string;
  name: string;
  media_type: string;
  size: number;
  sha256: string;
  integrity: { chunk_size: number; chunk_sha256: string[] };
  created_at?: string;
  updated_at?: string;
}

export interface AssetUploadProgress {
  id: string;
  asset_id: string;
  part_size: number;
  uploaded_parts: number[];
  completed: boolean;
  aborted: boolean;
}

type AssetUploadParent =
  | { content_id: string; chat_id?: never }
  | { chat_id: string; content_id?: never }
  | { content_id?: never; chat_id?: never };

export type AssetUploadRequest = AssetUploadParent & {
  name: string;
  media_type: string;
  size: number;
  sha256: string;
  attach_to_parent?: boolean;
};

export type ReactionKind = "Like" | "Love" | "Celebrate" | "Insightful";

export interface Reaction {
  member_id: string;
  kind: ReactionKind;
  comment_id?: string;
  created_at?: string;
  attribution?: string;
}

export interface ReactionSummary {
  like_count: number;
  love_count: number;
  celebrate_count: number;
  insightful_count: number;
  total_count: number;
  member_reaction?: ReactionKind;
}

export interface ContentSubscription {
  subscribed: boolean;
  subscriber_count: number;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface WebhookSubscription {
  id: string;
  application_id: string;
  grant_id: string;
  name: string;
  endpoint: string;
  events: [WebhookEvent];
  created_at: string;
  active: boolean;
}

export interface WebhookSubscriptionCreated extends WebhookSubscription {
  signing_secret: string;
}

export class BasstokApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BasstokApiError";
  }
}

export interface AccessTokenSource {
  accessToken(): Promise<string>;
}

export class BasstokClient {
  readonly #origin: URL;
  readonly #accessToken: string | AccessTokenSource;
  readonly #fetch: typeof fetch;

  constructor(
    origin: string,
    accessToken: string | AccessTokenSource,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.#origin = new URL(normalizeBasstokOrigin(origin));
    this.#accessToken = accessToken;
    this.#fetch = fetchImpl;
  }

  async getSession(): Promise<Principal> {
    return this.#request("GET", "/api/v1/auth/session");
  }

  async getContent(contentId: string): Promise<Content> {
    return this.#request<Content>(
      "GET",
      `/api/v1/contents/${encodeURIComponent(contentId)}`,
    );
  }

  async listContents(
    input: {
      offset?: number;
      limit?: number;
      order?: "oldest" | "newest";
      label_id?: string;
    } = {},
  ): Promise<ResourcePage<ContentSummary>> {
    return this.#request("GET", withQuery("/api/v1/contents", input));
  }

  async listComments(
    contentId: string,
    input: {
      offset?: number;
      limit?: number;
      order?: "oldest" | "newest";
    } = {},
  ): Promise<ResourcePage<Comment>> {
    return this.#request(
      "GET",
      withQuery(
        `/api/v1/contents/${encodeURIComponent(contentId)}/comments`,
        input,
      ),
    );
  }

  async getComment(contentId: string, commentId: string): Promise<Comment> {
    return this.#request(
      "GET",
      `/api/v1/contents/${encodeURIComponent(contentId)}` +
        `/comments/${encodeURIComponent(commentId)}`,
    );
  }

  async getCommentIfPresent(
    contentId: string,
    commentId: string,
  ): Promise<Comment | undefined> {
    try {
      return await this.getComment(contentId, commentId);
    } catch (error) {
      if (error instanceof BasstokApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async pauseReplies(contentId: string, paused = true): Promise<ContentMutationResult> {
    return this.#request<ContentMutationResult>(
      "PUT",
      `/api/v1/contents/${encodeURIComponent(contentId)}/replies`,
      { paused },
    );
  }

  async setFeatured(contentId: string, featured: boolean): Promise<ContentMutationResult> {
    return this.#request<ContentMutationResult>(
      "PUT",
      `/api/v1/contents/${encodeURIComponent(contentId)}/featured`,
      { featured },
    );
  }

  async setModeration(
    contentId: string,
    label: ModerationSystemLabel | null,
  ): Promise<ContentMutationResult> {
    return this.#request<ContentMutationResult>(
      "PUT",
      `/api/v1/contents/${encodeURIComponent(contentId)}/moderation`,
      { label },
    );
  }

  async setContentAudience(
    contentId: string,
    label: AudienceSystemLabel | null,
  ): Promise<ContentMutationResult> {
    return this.#request<ContentMutationResult>(
      "PUT",
      `/api/v1/contents/${encodeURIComponent(contentId)}/audience`,
      { label },
    );
  }

  async putMember(
    memberId: string,
    input: { display_name: string; description?: string | null; avatar?: CanonicalReference | null },
  ): Promise<MemberMutationResult> {
    return this.#request(
      "PUT",
      `/api/v1/members/${encodeURIComponent(memberId)}`,
      input,
    );
  }

  async createMember(
    memberId: string,
    input: { display_name: string; description?: string | null; avatar?: CanonicalReference | null },
  ): Promise<MemberMutationResult> {
    return this.#request(
      "PUT",
      `/api/v1/member-creations/${encodeURIComponent(memberId)}`,
      input,
    );
  }

  async listMembers(
    offset = 0,
    limit = 50,
  ): Promise<ResourcePage<Member>> {
    const parameters = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });
    return this.#request("GET", `/api/v1/members?${parameters}`);
  }

  async getMember(memberId: string): Promise<Member> {
    return this.#request(
      "GET",
      `/api/v1/members/${encodeURIComponent(memberId)}`,
    );
  }

  async listControlledMembers(
    offset = 0,
    limit = 50,
  ): Promise<ResourcePage<Member>> {
    const parameters = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });
    return this.#request("GET", `/api/v1/members/controlled?${parameters}`);
  }

  async searchMembers(
    query: string,
    limit = 20,
    offset?: number,
  ): Promise<ResourcePage<MemberPresentation>> {
    const parameters = new URLSearchParams({ q: query, limit: String(limit) });
    if (offset !== undefined) parameters.set("offset", String(offset));
    return this.#request("GET", `/api/v1/members/search?${parameters}`);
  }

  async putContentDraft(
    contentId: string,
    input: {
      title?: string;
      body: string;
      labels?: string[];
      author_id?: string;
      asset_ids?: string[];
    },
  ): Promise<ContentMutationResult> {
    return this.#request(
      "PUT",
      `/api/v1/content-drafts/${encodeURIComponent(contentId)}`,
      input,
    );
  }

  async createContentDraftSmallAsset(
    contentId: string,
    idempotencyKey: string,
    input: {
      name: string;
      media_type: string;
      bytes: Uint8Array<ArrayBuffer>;
    },
  ): Promise<Asset> {
    requireIdempotencyKey(idempotencyKey);
    return this.#createBufferedAsset(
      `/api/v1/content-drafts/${encodeURIComponent(contentId)}/assets`,
      input,
      idempotencyKey,
    );
  }

  async putContent(
    contentId: string,
    input: {
      title?: string;
      body: string;
      labels?: string[];
      audience?: "members_only" | "supporters_only" | "team_only";
      author_id?: string;
      asset_ids?: string[];
    },
  ): Promise<ContentMutationResult> {
    return this.#request(
      "PUT",
      `/api/v1/contents/${encodeURIComponent(contentId)}`,
      input,
    );
  }

  async publishContent(contentId: string): Promise<ContentMutationResult> {
    return this.#request(
      "POST",
      `/api/v1/content-drafts/${encodeURIComponent(contentId)}/publish`,
    );
  }

  async putComment(
    contentId: string,
    commentId: string,
    input: {
      body: string;
      parent_id?: string | null;
      author_id?: string;
      asset_ids?: string[];
    },
  ): Promise<CommentMutationResult> {
    return this.#request(
      "PUT",
      `/api/v1/contents/${encodeURIComponent(contentId)}` +
        `/comments/${encodeURIComponent(commentId)}`,
      input,
    );
  }

  async createComment(
    contentId: string,
    commentId: string,
    input: {
      body: string;
      parent_id?: string | null;
      author_id?: string;
      asset_ids?: string[];
    },
  ): Promise<CommentMutationResult> {
    return this.#request(
      "PUT",
      `/api/v1/contents/${encodeURIComponent(contentId)}` +
        `/comment-creations/${encodeURIComponent(commentId)}`,
      input,
    );
  }

  async setCommentModeration(
    contentId: string,
    commentId: string,
    label: ModerationSystemLabel | null,
  ): Promise<CommentMutationResult> {
    return this.#request(
      "PUT",
      `/api/v1/contents/${encodeURIComponent(contentId)}` +
        `/comments/${encodeURIComponent(commentId)}/moderation`,
      { label },
    );
  }

  async putReaction(
    contentId: string,
    kind: ReactionKind,
    input: { actor_id?: string; comment_id?: string } = {},
  ): Promise<void> {
    const parameters = new URLSearchParams({ content_id: contentId });
    if (input.comment_id !== undefined) parameters.set("comment_id", input.comment_id);
    if (input.actor_id !== undefined) parameters.set("actor_id", input.actor_id);
    await this.#request("PUT", `/api/v1/reaction?${parameters}`, { kind });
  }

  async deleteReaction(
    contentId: string,
    input: { actor_id?: string; comment_id?: string } = {},
  ): Promise<void> {
    const parameters = new URLSearchParams({ content_id: contentId });
    if (input.comment_id !== undefined) parameters.set("comment_id", input.comment_id);
    if (input.actor_id !== undefined) parameters.set("actor_id", input.actor_id);
    await this.#request("DELETE", `/api/v1/reaction?${parameters}`);
  }

  async listReactions(
    contentId: string,
    input: { comment_id?: string; offset?: number; limit?: number } = {},
  ): Promise<ResourcePage<Reaction>> {
    return this.#request(
      "GET",
      withQuery("/api/v1/reactions", { content_id: contentId, ...input }),
    );
  }

  async getReactionSummary(
    contentId: string,
    commentId?: string,
  ): Promise<ReactionSummary> {
    return this.#request(
      "GET",
      withQuery("/api/v1/reaction-summary", {
        content_id: contentId,
        comment_id: commentId,
      }),
    );
  }

  async getContentSubscription(
    contentId: string,
    actorId?: string,
  ): Promise<ContentSubscription> {
    return this.#request(
      "GET",
      withQuery(
        `/api/v1/contents/${encodeURIComponent(contentId)}/subscription`,
        { actor_id: actorId },
      ),
    );
  }

  async setContentSubscription(
    contentId: string,
    subscribed: boolean,
    actorId?: string,
  ): Promise<void> {
    const parameters = new URLSearchParams();
    if (actorId !== undefined) parameters.set("actor_id", actorId);
    const suffix = parameters.size === 0 ? "" : `?${parameters}`;
    await this.#request(
      subscribed ? "PUT" : "DELETE",
      `/api/v1/contents/${encodeURIComponent(contentId)}/subscription${suffix}`,
    );
  }

  async createChat(
    idempotencyKey: string,
    input: {
      participant_ids: string[];
      title?: string | null;
      creator_id?: string;
    },
  ): Promise<Chat | CanonicalReference> {
    requireIdempotencyKey(idempotencyKey);
    return this.#request(
      "POST",
      "/api/v1/chats",
      input,
      { "Idempotency-Key": idempotencyKey },
    );
  }

  async listChats(
    input: { actor_id?: string; offset?: number; limit?: number } = {},
  ): Promise<ResourcePage<Chat>> {
    return this.#request("GET", withQuery("/api/v1/chats", input));
  }

  async getChat(chatId: string, actorId?: string): Promise<Chat> {
    return this.#request(
      "GET",
      withQuery(`/api/v1/chats/${encodeURIComponent(chatId)}`, {
        actor_id: actorId,
      }),
    );
  }

  async addChatParticipant(
    chatId: string,
    memberId: string,
    actorId?: string,
  ): Promise<Chat | undefined> {
    return this.#request(
      "PUT",
      withQuery(
        `/api/v1/chats/${encodeURIComponent(chatId)}` +
          `/participants/${encodeURIComponent(memberId)}`,
        { actor_id: actorId },
      ),
    );
  }

  async getMessages(
    chatId: string,
    input: {
      actor_id?: string;
      offset?: number;
      limit?: number;
      order?: "oldest" | "newest";
    } = {},
  ): Promise<ResourcePage<Message>> {
    return this.#request(
      "GET",
      withQuery(`/api/v1/chats/${encodeURIComponent(chatId)}/messages`, input),
    );
  }

  async getMessage(
    chatId: string,
    messageId: string,
    actorId?: string,
  ): Promise<Message> {
    return this.#request(
      "GET",
      withQuery(
        `/api/v1/chats/${encodeURIComponent(chatId)}` +
          `/messages/${encodeURIComponent(messageId)}`,
        { actor_id: actorId },
      ),
    );
  }

  async sendMessage(
    chatId: string,
    idempotencyKey: string,
    input: { body: string; author_id?: string; asset_ids?: string[] },
  ): Promise<Message> {
    requireIdempotencyKey(idempotencyKey);
    return this.#request(
      "POST",
      `/api/v1/chats/${encodeURIComponent(chatId)}/messages`,
      input,
      { "Idempotency-Key": idempotencyKey },
    );
  }

  async sendDirectMessage(input: {
    chatIdempotencyKey: string;
    messageIdempotencyKey: string;
    responsibleMemberId: string;
    recipientMemberId: string;
    body: string;
  }): Promise<Message> {
    const chat = await this.createChat(input.chatIdempotencyKey, {
      participant_ids: [input.responsibleMemberId, input.recipientMemberId],
    });
    return this.sendMessage(chat.id, input.messageIdempotencyKey, {
      body: input.body,
    });
  }

  async createSmallAsset(
    idempotencyKey: string,
    parent: { content_id: string } | { chat_id: string },
    input: {
      name: string;
      media_type: string;
      bytes: Uint8Array<ArrayBuffer>;
      actor_id?: string;
    },
  ): Promise<Asset> {
    requireIdempotencyKey(idempotencyKey);
    const parameters = new URLSearchParams({
      ...parent,
    });
    if (input.actor_id !== undefined) parameters.set("actor_id", input.actor_id);
    return this.#createBufferedAsset(
      `/api/v1/assets?${parameters}`,
      input,
      idempotencyKey,
    );
  }

  async beginAssetUpload(
    idempotencyKey: string,
    input: AssetUploadRequest,
  ): Promise<AssetUploadProgress> {
    requireIdempotencyKey(idempotencyKey);
    return this.#request(
      "POST",
      "/api/v1/assets/uploads",
      input,
      { "Idempotency-Key": idempotencyKey },
    );
  }

  async putAssetUploadPart(
    uploadId: string,
    partNumber: number,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<AssetUploadProgress> {
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 4_096) {
      throw new Error("Asset upload part number is outside the supported range");
    }
    return this.#sendBytes(
      "PUT",
      `/api/v1/assets/uploads/${encodeURIComponent(uploadId)}` +
        `/parts/${partNumber}`,
      bytes,
      maximumAssetPartBytes,
    );
  }

  async completeAssetUpload(uploadId: string): Promise<Asset> {
    return this.#request(
      "POST",
      `/api/v1/assets/uploads/${encodeURIComponent(uploadId)}/complete`,
    );
  }

  async abortAssetUpload(uploadId: string): Promise<void> {
    await this.#request<void>(
      "DELETE",
      `/api/v1/assets/uploads/${encodeURIComponent(uploadId)}`,
    );
  }

  async getAssetMetadata(assetId: string, actorId?: string): Promise<Asset> {
    return this.#request(
      "GET",
      withQuery(`/api/v1/assets/${encodeURIComponent(assetId)}`, {
        metadata: 1,
        actor_id: actorId,
      }),
    );
  }

  async getAssetBytes(
    assetId: string,
    input: { actor_id?: string; range?: string } = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    return this.#send(
      withQuery(`/api/v1/assets/${encodeURIComponent(assetId)}`, { actor_id: input.actor_id }),
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
          ...(input.range === undefined ? {} : { Range: input.range }),
        },
      },
      async (response) => {
        if (!response.ok) await this.#decode<never>(response);
        return new Uint8Array(await readBoundedBody(
          response,
          maximumBufferedAssetBytes,
          "Asset response exceeds the 8 MiB buffered-client limit",
        ));
      },
    );
  }

  async attachChatAsset(
    chatId: string,
    assetId: string,
    actorId?: string,
  ): Promise<Chat | CanonicalReference> {
    return this.#request(
      "PUT",
      withQuery(
        `/api/v1/chats/${encodeURIComponent(chatId)}` +
          `/assets/${encodeURIComponent(assetId)}`,
        { actor_id: actorId },
      ),
    );
  }

  async detachChatAsset(
    chatId: string,
    assetId: string,
    actorId?: string,
  ): Promise<Chat | CanonicalReference> {
    return this.#request(
      "DELETE",
      withQuery(
        `/api/v1/chats/${encodeURIComponent(chatId)}` +
          `/assets/${encodeURIComponent(assetId)}`,
        { actor_id: actorId },
      ),
    );
  }

  async sendTyping(chatId: string, actorId?: string): Promise<void> {
    await this.#request(
      "POST",
      withQuery(`/api/v1/chats/${encodeURIComponent(chatId)}/typing`, {
        actor_id: actorId,
      }),
    );
  }

  async putWebhook(
    applicationId: string,
    webhookId: string,
    input: {
      grant_id: string;
      name: string;
      endpoint: string;
      events: [WebhookEvent];
    },
  ): Promise<WebhookSubscriptionCreated> {
    return this.#request(
      "PUT",
      `/api/v1/applications/${encodeURIComponent(applicationId)}` +
        `/webhooks/${encodeURIComponent(webhookId)}`,
      input,
    );
  }

  async listWebhooks(
    applicationId: string,
    offset = 0,
    limit = 50,
  ): Promise<ResourcePage<WebhookSubscription>> {
    return this.#request(
      "GET",
      withQuery(
        `/api/v1/applications/${encodeURIComponent(applicationId)}/webhooks`,
        { offset, limit },
      ),
    );
  }

  async deleteWebhook(applicationId: string, webhookId: string): Promise<void> {
    await this.#request<void>(
      "DELETE",
      `/api/v1/applications/${encodeURIComponent(applicationId)}` +
        `/webhooks/${encodeURIComponent(webhookId)}`,
    );
  }

  async revokeGrant(grantId: string): Promise<void> {
    await this.#request<void>(
      "DELETE",
      `/api/v1/application-grants/${encodeURIComponent(grantId)}`,
    );
  }

  async #createBufferedAsset(
    path: string,
    input: {
      name: string;
      media_type: string;
      bytes: Uint8Array<ArrayBuffer>;
    },
    idempotencyKey: string,
  ): Promise<Asset> {
    if (input.bytes.byteLength > maximumBufferedAssetBytes) {
      throw new Error("Small Asset payload exceeds 8 MiB");
    }
    const parameters = new URLSearchParams({
      name: input.name,
      media_type: input.media_type,
    });
    const separator = path.includes("?") ? "&" : "?";
    return this.#sendBytes(
      "POST",
      `${path}${separator}${parameters}`,
      input.bytes,
      maximumBufferedAssetBytes,
      { "Idempotency-Key": idempotencyKey },
    );
  }

  async #sendBytes<T>(
    method: string,
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
    maximumBytes: number,
    headers: Record<string, string> = {},
  ): Promise<T> {
    if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
      throw new Error("Asset upload bytes are outside the supported range");
    }
    return this.#send(path, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/octet-stream",
        ...headers,
      },
      body: bytes,
    }, (response) => this.#decode<T>(response));
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    return this.#send(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, (response) => this.#decode<T>(response));
  }

  async #send<T>(
    path: string,
    request: RequestInit,
    decode: (response: Response) => Promise<T>,
  ): Promise<T> {
    const headers = new Headers(request.headers);
    const replaySafe = ["GET", "PUT", "DELETE"].includes(request.method ?? "GET") ||
      (request.method === "POST" && headers.has("Idempotency-Key"));
    const deadline = performance.now() + requestTimeoutMs;
    const signal = AbortSignal.timeout(requestTimeoutMs);
    for (let attempt = 0; ; ++attempt) {
      // Credential rotation failures are not REST failures and must never be replayed here.
      headers.set("Authorization", `Bearer ${await this.#currentAccessToken()}`);
      let response: Response | undefined;
      try {
        response = await this.#fetch(new URL(path, this.#origin), {
          ...request, headers, signal, redirect: "error",
        });
        return await decode(response);
      } catch (error) {
        const transient = error instanceof BasstokApiError
          ? error.retryable && (error.status === 409 || error.status === 429 || error.status >= 500)
          : response === undefined && error instanceof TypeError;
        if (!replaySafe || !transient || attempt >= 2 || signal.aborted) throw error;
        const backoff = Math.ceil(250 * 2 ** attempt + Math.random() * 125);
        const wait = Math.max(backoff, retryAfterMs(response?.headers.get("retry-after")));
        if (performance.now() + wait >= deadline) throw error;
        await delay(wait, undefined, { signal });
      }
    }
  }

  async #currentAccessToken(): Promise<string> {
    return typeof this.#accessToken === "string"
      ? this.#accessToken
      : this.#accessToken.accessToken();
  }

  async #decode<T>(response: Response): Promise<T> {
    const text = Buffer.from(await readBoundedBody(
      response,
      maximumJsonResponseBytes,
      "Basstok JSON response is too large",
    )).toString("utf8");
    if (!response.ok) {
      let error: ApiErrorEnvelope | undefined;
      try {
        const value: unknown = JSON.parse(text);
        if (isApiErrorEnvelope(value)) error = value;
      } catch {
        // Keep an invalid or non-JSON response outside the typed API contract.
      }
      throw new BasstokApiError(
        response.status,
        error?.error.code ?? "request_failed",
        error?.error.message ?? `Basstok REST request failed with ${response.status}`,
        error?.error.retryable ??
          (response.status === 409 || response.status === 429 || response.status >= 500),
      );
    }

    return (text.length === 0 ? undefined : JSON.parse(text)) as T;
  }
}

function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = value.error;
  return typeof error === "object" && error !== null &&
    "code" in error && typeof error.code === "string" &&
    "message" in error && typeof error.message === "string" &&
    "retryable" in error && typeof error.retryable === "boolean";
}

const requestTimeoutMs = 30_000;
const maximumJsonResponseBytes = 72 * 1024 * 1024;
const maximumBufferedAssetBytes = 8 * 1024 * 1024;
const maximumAssetPartBytes = 16 * 1024 * 1024;

function requireIdempotencyKey(value: string): void {
  if (!isIdempotencyKey(value)) {
    throw new Error("Idempotency-Key must be a lowercase UUIDv4 value");
  }
}

function retryAfterMs(value: string | null | undefined): number {
  if (value == null) return 0;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  message: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximumBytes) {
    await response.body?.cancel();
    throw new Error(message);
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error(message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks, size));
}

function withQuery(
  path: string,
  values: Record<string, string | number | undefined>,
): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) parameters.set(name, String(value));
  }
  const query = parameters.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}
