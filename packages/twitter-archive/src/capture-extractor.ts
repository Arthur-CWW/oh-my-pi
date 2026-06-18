import type { ArchiveTweet, ArchiveUser, ArchiveMedia, ArchivePublicMetrics } from "./schema";
import type { CaptureProvenance } from "./capture-types";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ExtractedArchiveRecords {
  tweets: ArchiveTweet[];
  users: ArchiveUser[];
  media: ArchiveMedia[];
  provenance: CaptureProvenance;
}

/**
 * Traverses a JSON payload recursively to extract user, tweet, and media records.
 * Binds each record with the provided source provenance details.
 */
export function extractTweetsFromFixture(
  payload: JsonValue,
  provenance: CaptureProvenance
): ExtractedArchiveRecords {
  const tweetsMap = new Map<string, ArchiveTweet>();
  const usersMap = new Map<string, ArchiveUser>();
  const mediaMap = new Map<string, ArchiveMedia>();

  const traverse = (val: JsonValue): void => {
    if (val === null || typeof val !== "object") {
      return;
    }

    if (Array.isArray(val)) {
      for (const item of val) {
        traverse(item);
      }
      return;
    }

    const obj = val as Record<string, JsonValue>;

    // 1. Detect User
    let userId: string | undefined;
    let username: string | undefined;
    let displayName: string | undefined;
    let avatarUrl: string | undefined;
    let profileUrl: string | undefined;
    let description: string | undefined;
    let verified: boolean | undefined;
    let isProtected: boolean | undefined;

    const isLegacyUser =
      typeof obj.screen_name === "string" ||
      (obj.legacy && typeof (obj.legacy as Record<string, JsonValue>).screen_name === "string");

    if (isLegacyUser) {
      const legacy = ((obj.legacy as Record<string, JsonValue>) || obj) as Record<string, JsonValue>;
      userId =
        typeof obj.rest_id === "string"
          ? obj.rest_id
          : typeof obj.id === "string"
            ? obj.id
            : undefined;
      username = typeof legacy.screen_name === "string" ? legacy.screen_name : undefined;
      displayName = typeof legacy.name === "string" ? legacy.name : undefined;
      avatarUrl =
        typeof legacy.profile_image_url_https === "string"
          ? legacy.profile_image_url_https
          : undefined;
      description = typeof legacy.description === "string" ? legacy.description : undefined;
      verified = typeof legacy.verified === "boolean" ? legacy.verified : undefined;
      isProtected = typeof legacy.protected === "boolean" ? legacy.protected : undefined;
    } else if (
      typeof obj.username === "string" &&
      (typeof obj.id === "string" || typeof obj.rest_id === "string")
    ) {
      userId = typeof obj.id === "string" ? obj.id : (obj.rest_id as string);
      username = obj.username as string;
      displayName =
        typeof obj.displayName === "string"
          ? obj.displayName
          : typeof obj.name === "string"
            ? (obj.name as string)
            : undefined;
      avatarUrl =
        typeof obj.avatarUrl === "string"
          ? obj.avatarUrl
          : typeof obj.profile_image_url === "string"
            ? (obj.profile_image_url as string)
            : undefined;
      description = typeof obj.description === "string" ? obj.description : undefined;
      verified = typeof obj.verified === "boolean" ? obj.verified : undefined;
      isProtected = typeof obj.protected === "boolean" ? obj.protected : undefined;
    }

    if (userId && username) {
      profileUrl = `https://x.com/${username}`;
      const userRecord: ArchiveUser = {
        id: userId,
        username,
        displayName,
        avatarUrl,
        profileUrl,
        description,
        verified,
        protected: isProtected,
        capturedAt: provenance.capturedAt,
      };
      usersMap.set(userId, userRecord);
    }

    // 2. Detect Tweet
    let tweetId: string | undefined;
    let authorId: string | undefined;
    let text: string | undefined;
    let createdAt: string | undefined;
    let conversationId: string | undefined;
    let inReplyToTweetId: string | undefined;
    let inReplyToUserId: string | undefined;
    let replyToUsername: string | undefined;
    let quotedTweetId: string | undefined;
    let quotedTweetUrl: string | undefined;
    let mediaList: Record<string, JsonValue>[] = [];
    let language: string | undefined;
    let publicMetrics: ArchivePublicMetrics | undefined;

    const hasLegacyTweet =
      obj.legacy && typeof (obj.legacy as Record<string, JsonValue>).full_text === "string";
    const hasSimpleTweet =
      typeof obj.text === "string" &&
      (typeof obj.id === "string" || typeof obj.rest_id === "string");

    if (hasLegacyTweet || hasSimpleTweet) {
      const legacy = (hasLegacyTweet ? obj.legacy : obj) as Record<string, JsonValue>;
      tweetId =
        typeof obj.rest_id === "string"
          ? obj.rest_id
          : typeof obj.id === "string"
            ? obj.id
            : undefined;

      // Extract author ID from GraphQL nested core if present
      if (obj.core && typeof obj.core === "object") {
        const coreObj = obj.core as Record<string, JsonValue>;
        if (coreObj.user_results && typeof coreObj.user_results === "object") {
          const userResults = coreObj.user_results as Record<string, JsonValue>;
          if (userResults.result && typeof userResults.result === "object") {
            const res = userResults.result as Record<string, JsonValue>;
            if (typeof res.rest_id === "string") {
              authorId = res.rest_id;
            }
            const nestedLegacy = res.legacy;
            if (nestedLegacy && typeof nestedLegacy === "object") {
              const nestedUser = nestedLegacy as Record<string, JsonValue>;
              if (typeof nestedUser.screen_name === "string") {
                username = nestedUser.screen_name;
              }
            }
          }
        }
      }

      if (!authorId) {
        authorId =
          typeof legacy.user_id_str === "string"
            ? legacy.user_id_str
            : typeof obj.authorId === "string"
              ? obj.authorId
              : undefined;
      }

      text =
        typeof legacy.full_text === "string"
          ? legacy.full_text
          : typeof legacy.text === "string"
            ? legacy.text
            : undefined;
      createdAt =
        typeof legacy.created_at === "string"
          ? legacy.created_at
          : typeof legacy.createdAt === "string"
            ? legacy.createdAt
            : undefined;
      conversationId =
        typeof legacy.conversation_id_str === "string"
          ? legacy.conversation_id_str
          : typeof legacy.conversationId === "string"
            ? legacy.conversationId
            : undefined;
      inReplyToTweetId =
        typeof legacy.in_reply_to_status_id_str === "string"
          ? legacy.in_reply_to_status_id_str
          : typeof legacy.inReplyToTweetId === "string"
            ? legacy.inReplyToTweetId
            : undefined;
      inReplyToUserId =
        typeof legacy.in_reply_to_user_id_str === "string"
          ? legacy.in_reply_to_user_id_str
          : typeof legacy.inReplyToUserId === "string"
            ? legacy.inReplyToUserId
            : undefined;
      replyToUsername =
        typeof legacy.in_reply_to_screen_name === "string"
          ? legacy.in_reply_to_screen_name
          : typeof legacy.replyToUsername === "string"
            ? legacy.replyToUsername
            : undefined;
      quotedTweetId =
        typeof legacy.quoted_status_id_str === "string"
          ? legacy.quoted_status_id_str
          : typeof legacy.quotedTweetId === "string"
            ? legacy.quotedTweetId
            : undefined;

      if (legacy.quoted_status_permalink && typeof legacy.quoted_status_permalink === "object") {
        const perm = legacy.quoted_status_permalink as Record<string, JsonValue>;
        if (typeof perm.url === "string") {
          quotedTweetUrl = perm.url;
        }
      } else if (typeof legacy.quotedTweetUrl === "string") {
        quotedTweetUrl = legacy.quotedTweetUrl;
      }

      language =
        typeof legacy.lang === "string"
          ? legacy.lang
          : typeof legacy.language === "string"
            ? legacy.language
            : undefined;

      // Extract media entities
      if (legacy.entities && typeof legacy.entities === "object") {
        const entities = legacy.entities as Record<string, JsonValue>;
        if (Array.isArray(entities.media)) {
          mediaList = entities.media as Record<string, JsonValue>[];
        }
      }
      if (
        mediaList.length === 0 &&
        legacy.extended_entities &&
        typeof legacy.extended_entities === "object"
      ) {
        const extEntities = legacy.extended_entities as Record<string, JsonValue>;
        if (Array.isArray(extEntities.media)) {
          mediaList = extEntities.media as Record<string, JsonValue>[];
        }
      }
      if (mediaList.length === 0 && Array.isArray(legacy.media)) {
        mediaList = legacy.media as Record<string, JsonValue>[];
      }

      // Public metrics
      const likes =
        typeof legacy.favorite_count === "number"
          ? legacy.favorite_count
          : typeof legacy.like_count === "number"
            ? legacy.like_count
            : undefined;
      const reposts =
        typeof legacy.retweet_count === "number"
          ? legacy.retweet_count
          : typeof legacy.repost_count === "number"
            ? legacy.repost_count
            : undefined;
      const replies = typeof legacy.reply_count === "number" ? legacy.reply_count : undefined;
      const quotes = typeof legacy.quote_count === "number" ? legacy.quote_count : undefined;
      let views: number | undefined;

      if (obj.views && typeof obj.views === "object") {
        const viewsObj = obj.views as Record<string, JsonValue>;
        if (typeof viewsObj.count === "string") {
          views = parseInt(viewsObj.count, 10);
        } else if (typeof viewsObj.count === "number") {
          views = viewsObj.count;
        }
      }

      if (
        likes !== undefined ||
        reposts !== undefined ||
        replies !== undefined ||
        quotes !== undefined ||
        views !== undefined
      ) {
        publicMetrics = { likes, reposts, replies, quotes, views };
      }
    }

    if (tweetId && text) {
      let tweetUsername = username;
      if (!tweetUsername && authorId) {
        const matchingUser = usersMap.get(authorId);
        if (matchingUser) {
          tweetUsername = matchingUser.username;
        }
      }

      const mediaIds: string[] = [];
      for (const m of mediaList) {
        const mId =
          typeof m.id_str === "string"
            ? m.id_str
            : typeof m.id === "string"
              ? m.id
              : undefined;
        if (mId) {
          mediaIds.push(mId);

          let mType: "image" | "video" | "gif" | "unknown" = "unknown";
          const typeStr = typeof m.type === "string" ? m.type : "";
          if (typeStr === "photo") {
            mType = "image";
          } else if (typeStr === "video") {
            mType = "video";
          } else if (typeStr === "animated_gif") {
            mType = "gif";
          }

          const mediaRecord: ArchiveMedia = {
            id: mId,
            tweetId,
            type: mType,
            remoteUrl:
              typeof m.media_url_https === "string"
                ? m.media_url_https
                : typeof m.remoteUrl === "string"
                  ? (m.remoteUrl as string)
                  : undefined,
            altText:
              typeof m.ext_alt_text === "string"
                ? m.ext_alt_text
                : typeof m.altText === "string"
                  ? (m.altText as string)
                  : undefined,
            capturedAt: provenance.capturedAt,
            source: "frontend",
          };
          mediaMap.set(mId, mediaRecord);
        }
      }

      const tweetRecord: ArchiveTweet = {
        id: tweetId,
        authorId: authorId ?? "unknown",
        username: tweetUsername,
        url: `https://x.com/${tweetUsername || "i"}/status/${tweetId}`,
        text,
        createdAt,
        conversationId,
        inReplyToTweetId,
        inReplyToUserId,
        replyToUsername,
        quotedTweetId,
        quotedTweetUrl,
        mediaIds,
        language,
        publicMetrics,
        capturedAt: provenance.capturedAt,
        source: "frontend",
      };
      tweetsMap.set(tweetId, tweetRecord);
    }

    // Traverse recursively
    for (const key of Object.keys(obj)) {
      traverse(obj[key]);
    }
  };

  traverse(payload);

  return {
    tweets: Array.from(tweetsMap.values()),
    users: Array.from(usersMap.values()),
    media: Array.from(mediaMap.values()),
    provenance,
  };
}
