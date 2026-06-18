import { describe, expect, test } from "bun:test";
import {
  CaptureQueuePlanner,
  checkCaptureTargetPolicy,
  checkUrlPolicy,
  classifyStopCondition,
  extractTweetsFromFixture,
  type CaptureTarget,
  type CaptureProvenance,
  type JsonValue,
} from "../src";

describe("Safety Policy Gate", () => {
  test("blocks unsafe URL paths", () => {
    expect(checkUrlPolicy("https://x.com/messages").allowed).toBe(false);
    expect(checkUrlPolicy("https://twitter.com/messages/123").allowed).toBe(false);

    expect(checkUrlPolicy("https://x.com/settings").allowed).toBe(false);
    expect(checkUrlPolicy("https://x.com/settings/account").allowed).toBe(false);

    expect(checkUrlPolicy("https://x.com/bookmarks").allowed).toBe(false);
    expect(checkUrlPolicy("https://x.com/i/bookmarks").allowed).toBe(false);

    expect(checkUrlPolicy("https://x.com/notifications").allowed).toBe(false);
    expect(checkUrlPolicy("https://x.com/i/notifications").allowed).toBe(false);

    expect(checkUrlPolicy("https://x.com/jack/likes").allowed).toBe(false);
    expect(checkUrlPolicy("https://x.com/i/likes").allowed).toBe(false);
    expect(checkUrlPolicy("https://x.com/likes").allowed).toBe(false);

    expect(checkUrlPolicy("https://x.com/jack").allowed).toBe(true);
    expect(checkUrlPolicy("https://x.com/jack/status/12345").allowed).toBe(true);
    expect(checkUrlPolicy("https://x.com/hashtag/test").allowed).toBe(true);
  });

  test("blocks unsafe CaptureTargets", () => {
    const dmTarget: CaptureTarget = { type: "direct-messages", value: "messages" };
    expect(checkCaptureTargetPolicy(dmTarget).allowed).toBe(false);

    const settingsTarget: CaptureTarget = { type: "settings", value: "settings" };
    expect(checkCaptureTargetPolicy(settingsTarget).allowed).toBe(false);

    const bookmarksTarget: CaptureTarget = { type: "bookmarks", value: "bookmarks" };
    expect(checkCaptureTargetPolicy(bookmarksTarget).allowed).toBe(false);

    const likesTarget: CaptureTarget = { type: "likes", value: "likes" };
    expect(checkCaptureTargetPolicy(likesTarget).allowed).toBe(false);

    const notificationsTarget: CaptureTarget = { type: "notifications", value: "notifications" };
    expect(checkCaptureTargetPolicy(notificationsTarget).allowed).toBe(false);

    const protectedTarget: CaptureTarget = {
      type: "user-profile",
      value: "jack",
      protected: true,
    };
    expect(checkCaptureTargetPolicy(protectedTarget).allowed).toBe(false);

    const safeTarget: CaptureTarget = {
      type: "user-profile",
      value: "jack",
      protected: false,
    };
    expect(checkCaptureTargetPolicy(safeTarget).allowed).toBe(true);
  });
});

describe("Queue Planner", () => {
  test("enforces one-job-at-a-time execution by default", () => {
    const planner = new CaptureQueuePlanner();
    const target1: CaptureTarget = { type: "user-timeline", value: "user1" };
    const target2: CaptureTarget = { type: "user-timeline", value: "user2" };

    const job1 = planner.addJob(target1);
    const job2 = planner.addJob(target2);

    expect(planner.getJobs().length).toBe(2);

    const active1 = planner.startJob(job1.id);
    expect(active1.status).toBe("processing");

    expect(planner.getNextJob()).toBeNull();

    expect(() => planner.startJob(job2.id)).toThrow();

    const prov: CaptureProvenance = {
      sourceUrl: "https://x.com/user1",
      capturedAt: new Date().toISOString(),
      sessionInfo: { userAgent: "Mozilla/5.0" },
      runId: "run-123",
    };
    planner.completeJob(job1.id, prov);

    const next = planner.getNextJob();
    expect(next).not.toBeNull();
    expect(next?.id).toBe(job2.id);

    const active2 = planner.startJob(job2.id);
    expect(active2.status).toBe("processing");
  });

  test("rejects adding job that violates safety policy", () => {
    const planner = new CaptureQueuePlanner();
    const badTarget: CaptureTarget = { type: "bookmarks", value: "bookmarks" };
    expect(() => planner.addJob(badTarget)).toThrow();
  });
});

describe("Stop Condition Classifier", () => {
  test("detects rate limits", () => {
    expect(classifyStopCondition({ status: 429, headers: {} }).shouldStop).toBe(true);

    expect(
      classifyStopCondition({ status: 200, headers: { "x-rate-limit-remaining": "0" } }).shouldStop
    ).toBe(true);

    expect(classifyStopCondition({ status: 200, headers: { "retry-after": "60" } }).shouldStop).toBe(
      true
    );

    const rateLimitBody = JSON.stringify({
      errors: [{ code: 88, message: "Rate limit exceeded" }],
    });
    expect(classifyStopCondition({ status: 200, headers: {}, body: rateLimitBody }).shouldStop).toBe(
      true
    );
  });

  test("detects security challenges and locks", () => {
    expect(classifyStopCondition({ status: 403, headers: {} }).shouldStop).toBe(true);

    const lockBody = JSON.stringify({
      errors: [{ code: 326, message: "To protect our users, your account is temporarily locked." }],
    });
    expect(classifyStopCondition({ status: 200, headers: {}, body: lockBody }).shouldStop).toBe(true);

    const challengeHtml = "<html><body><iframe src='https://arkoselabs.com'></iframe></body></html>";
    expect(classifyStopCondition({ status: 200, headers: {}, html: challengeHtml }).shouldStop).toBe(
      true
    );

    const loginHtml = "<html><body>Redirecting to /i/flow/login</body></html>";
    expect(classifyStopCondition({ status: 200, headers: {}, html: loginHtml }).shouldStop).toBe(true);
  });
});

describe("Fixture Extractor", () => {
  const prov: CaptureProvenance = {
    sourceUrl: "https://x.com/elonmusk",
    capturedAt: "2026-06-14T12:00:00Z",
    sessionInfo: { userAgent: "Mozilla/5.0" },
    runId: "run-999",
  };

  test("extracts from simple flat structure", () => {
    const payload: JsonValue = {
      id: "1001",
      text: "Testing the safe capture extractor prototype.",
      username: "elonmusk",
      authorId: "44",
      createdAt: "2026-06-14T11:50:00Z",
      likes: 120,
    };

    const result = extractTweetsFromFixture(payload, prov);
    expect(result.tweets.length).toBe(1);
    expect(result.tweets[0].id).toBe("1001");
    expect(result.tweets[0].text).toBe("Testing the safe capture extractor prototype.");
    expect(result.tweets[0].username).toBe("elonmusk");
    expect(result.tweets[0].capturedAt).toBe(prov.capturedAt);
    expect(result.tweets[0].url).toBe("https://x.com/elonmusk/status/1001");
    expect(result.provenance.runId).toBe("run-999");
  });

  test("extracts from nested GraphQL structure", () => {
    const payload: JsonValue = {
      globalObjects: {
        tweets: {
          "2002": {
            rest_id: "2002",
            core: {
              user_results: {
                result: {
                  rest_id: "777",
                  legacy: {
                    screen_name: "testuser",
                    name: "Test User",
                    description: "Example desc",
                  },
                },
              },
            },
            legacy: {
              full_text: "Nested thread tweet example.",
              created_at: "Sun Jun 14 11:00:00 +0000 2026",
              conversation_id_str: "2002",
              favorite_count: 50,
              entities: {
                media: [
                  {
                    id_str: "9001",
                    type: "photo",
                    media_url_https: "https://x.com/media.jpg",
                  },
                ],
              },
            },
          },
        },
      },
    };

    const result = extractTweetsFromFixture(payload, prov);
    expect(result.tweets.length).toBe(1);
    expect(result.tweets[0].id).toBe("2002");
    expect(result.tweets[0].username).toBe("testuser");
    expect(result.tweets[0].publicMetrics?.likes).toBe(50);
    expect(result.tweets[0].mediaIds).toContain("9001");

    expect(result.users.length).toBe(1);
    expect(result.users[0].id).toBe("777");
    expect(result.users[0].username).toBe("testuser");

    expect(result.media.length).toBe(1);
    expect(result.media[0].id).toBe("9001");
    expect(result.media[0].type).toBe("image");
    expect(result.media[0].remoteUrl).toBe("https://x.com/media.jpg");
  });
});
