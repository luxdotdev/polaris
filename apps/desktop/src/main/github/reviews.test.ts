import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Exit, Fiber } from "effect";
import type { PullRef } from "../../shared/github.ts";
import { harness, signIn, until } from "./github.testing.ts";
import { GitHub, type NewThread } from "./index.ts";
import { threadInput, threadProblem } from "./reviews.ts";

const harnesses: Array<ReturnType<typeof harness>> = [];

const open = (options: Parameters<typeof harness>[0] = {}) => {
  const h = harness(options);

  harnesses.push(h);

  return h;
};

afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup();
});

const PR42: PullRef = { repo: { owner: "acme", name: "widgets" }, number: 42 };

const PR43: PullRef = { repo: { owner: "acme", name: "widgets" }, number: 43 };

const ID42 = "PR_kwDOacme42";

const line = (fields: Partial<NewThread> = {}): NewThread => ({
  pull: PR42,
  pullId: ID42,
  commitOid: "9f2c4e1a7b3d5f60812a4c6e8b0d2f4a6c8e0b21",
  path: "src/webhooks/deliver.ts",
  body: "Cap the attempts here.",
  subjectType: "line",
  line: 30,
  side: "right",
  startLine: null,
  startSide: null,
  ...fields,
});

/** Runs `body` as mona, signed in. */
const asMona = <A, E>(h: ReturnType<typeof harness>, body: Effect.Effect<A, E, GitHub>) =>
  h.run(Effect.andThen(signIn(h, "mona"), body));

describe("a pull request's detail", () => {
  test("files with Viewed state, threads with current and outdated anchors", async () => {
    const h = open();

    const detail = await asMona(
      h,
      GitHub.use((gh) => gh.detail(PR42))
    );

    expect(detail.files.map((f) => [f.path, f.viewed])).toEqual([
      ["src/webhooks/deliver.ts", "unviewed"],
      ["src/webhooks/backoff.ts", "unviewed"],
      ["test/webhooks/deliver.test.ts", "unviewed"],
    ]);
    expect(detail.threads.map((t) => t.anchor)).toEqual([
      { kind: "line", line: 27, startLine: null, side: "right", startSide: null },
      {
        kind: "outdated",
        originalLine: 12,
        originalStartLine: null,
        side: "right",
        commitOid: "77aa11bb22cc33dd44ee55ff6600778899aabbcc",
        diffHunk: '@@ -10,4 +10,5 @@ import { post } from "./http.ts";\n+const MAX = 3;',
      },
    ]);
    expect(detail).toMatchObject({
      viewerLogin: "mona",
      viewerCanApprove: true,
      pendingReview: null,
      state: "open",
    });
  });

  test("a repository nobody can see fails with no account", async () => {
    const h = open();

    const exit = await asMona(
      h,
      Effect.exit(
        GitHub.use((gh) => gh.detail({ repo: { owner: "lockedorg", name: "vault" }, number: 1 }))
      )
    );

    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("GitHubNoAccount");
  });
});

describe("the pending review", () => {
  test("is created by the first comment and collects the rest", async () => {
    const h = open();

    const detail = await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          const first = yield* gh.addThread(line());
          const range = yield* gh.addThread(line({ line: 34, startLine: 31, startSide: "right" }));

          const file = yield* gh.addThread(
            line({ subjectType: "file", line: null, path: "src/webhooks/backoff.ts" })
          );

          expect(range.reviewId).toBe(first.reviewId);
          expect(file.reviewId).toBe(first.reviewId);
          yield* gh.reply({
            pull: PR42,
            pullId: ID42,
            threadId: "PRRT_kwDOacme01",
            body: "Agreed with hubot.",
          });

          return yield* gh.detail(PR42);
        })
      )
    );

    expect(detail.pendingReview).toMatchObject({ comments: 4 });
    expect(h.fake.world.reviews).toMatchObject([{ state: "PENDING", author: "mona" }]);
    expect(detail.threads.find((t) => t.path === "src/webhooks/backoff.ts")?.anchor).toEqual({
      kind: "file",
    });
    expect(detail.threads.find((t) => t.id === "PRRT_kwDOacme01")?.comments.at(-1)).toMatchObject({
      pending: true,
      author: "mona",
    });
    expect(h.fake.world.threads.find((t) => t.startLine === 31)).toMatchObject({
      line: 34,
      side: "RIGHT",
      startSide: "RIGHT",
    });
  });

  test("picks up a pending review started on github.com", async () => {
    const h = open();

    const reviews = await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          yield* gh.addThread(line());

          // A second app (another window, another Mac) with no cache.
          return h.fake.world.reviews.length;
        })
      )
    );

    const second = open({ sharedFake: h.fake, dir: h.dir });

    await second.run(GitHub.use((gh) => gh.addThread(line({ line: 40 }))));
    expect(reviews).toBe(1);
    expect(h.fake.world.reviews.length).toBe(1);
  });

  test("submits as Comment, Request changes or Approve", async () => {
    const h = open();

    await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          yield* gh.addThread(line());
          yield* gh.submitReview({ pull: PR42, pullId: ID42, event: "comment", body: "" });
          yield* gh.submitReview({ pull: PR42, pullId: ID42, event: "approve", body: "Ship it." });
        })
      )
    );

    expect(h.fake.world.reviews.map((r) => [r.state, r.body])).toEqual([
      ["COMMENTED", ""],
      ["APPROVED", "Ship it."],
    ]);

    const pull = h.fake.world.pulls.find((p) => p.id === ID42);

    expect(pull?.reviewDecision).toBe("APPROVED");
    expect(pull?.reviewRequests).toEqual([]);
  });

  test("refuses what GitHub would refuse, before asking", async () => {
    const h = open();

    const failures = await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          yield* gh.detail(PR43);

          const attempts = [
            gh.submitReview({ pull: PR43, pullId: "PR_kwDOacme43", event: "approve", body: "" }),
            gh.submitReview({ pull: PR42, pullId: ID42, event: "request-changes", body: " " }),
            gh.submitReview({ pull: PR42, pullId: ID42, event: "comment", body: "" }),
            Effect.asVoid(gh.addThread(line({ body: "" }))),
            Effect.asVoid(gh.addThread(line({ line: null }))),
          ];

          return yield* Effect.forEach(attempts, (attempt) =>
            Effect.match(attempt, { onFailure: (e) => e._tag, onSuccess: () => "ok" })
          );
        })
      )
    );

    expect(failures).toEqual(Array.from({ length: 5 }, () => "GitHubInvalidReview"));
    expect(
      h.fake.requests.filter((r) => r.name.startsWith("Submit") || r.name.startsWith("Add")).length
    ).toBe(0);
  });

  test("discarding deletes the pending review and its comments", async () => {
    const h = open();

    const detail = await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          yield* gh.addThread(line());
          yield* gh.discardReview({ pull: PR42, pullId: ID42 });

          return yield* gh.detail(PR42);
        })
      )
    );

    expect(detail.pendingReview).toBeNull();
    expect(detail.threads.length).toBe(2);
    expect(h.fake.world.reviews).toEqual([]);
  });

  test("resolves, edits and deletes", async () => {
    const h = open();

    const detail = await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          const { threadId } = yield* gh.addThread(line());
          const before = yield* gh.detail(PR42);
          const commentId = before.threads.find((t) => t.id === threadId)?.comments[0]?.id ?? "";

          yield* gh.resolveThread({ pull: PR42, threadId: "PRRT_kwDOacme01", resolved: true });
          yield* gh.resolveThread({ pull: PR42, threadId: "PRRT_kwDOacme02", resolved: false });
          yield* gh.editComment({ pull: PR42, commentId, body: "Cap at five." });

          const edited = yield* gh.detail(PR42);

          expect(edited.threads.find((t) => t.id === threadId)?.comments[0]?.body).toBe(
            "Cap at five."
          );
          yield* gh.editComment({ pull: PR42, commentId, body: null });

          return yield* gh.detail(PR42);
        })
      )
    );

    expect(detail.threads.map((t) => [t.id, t.isResolved])).toEqual([
      ["PRRT_kwDOacme01", true],
      ["PRRT_kwDOacme02", false],
    ]);
  });

  test("mutations wait a second after the account's last one", async () => {
    const h = open({ mutationGapMs: 1000 });

    await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          yield* gh.resolveThread({ pull: PR42, threadId: "PRRT_kwDOacme01", resolved: true });

          const second = yield* Effect.forkChild(
            gh.resolveThread({ pull: PR42, threadId: "PRRT_kwDOacme01", resolved: false })
          );

          yield* Effect.yieldNow;
          expect(h.fake.world.threads[0]?.isResolved).toBe(true);
          yield* h.advance(1000);
          yield* Fiber.join(second);
          expect(h.fake.world.threads[0]?.isResolved).toBe(false);
        })
      )
    );
  });
});

describe("Viewed", () => {
  test("marks sync with GitHub; new commits turn them into changed-since-viewed", async () => {
    const h = open();

    const views = await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          const mark = (path: string, viewed: boolean) =>
            gh.setViewed({ pull: PR42, pullId: ID42, path, viewed });

          yield* mark("src/webhooks/deliver.ts", true);
          yield* mark("src/webhooks/backoff.ts", true);
          yield* mark("src/webhooks/backoff.ts", false);

          const marked = yield* gh.detail(PR42);

          h.fake.push("acme/widgets", 42);

          const pushed = yield* gh.detail(PR42);

          return [marked, pushed].map((d) => d.files.map((f) => f.viewed));
        })
      )
    );

    expect(views).toEqual([
      ["viewed", "unviewed", "unviewed"],
      ["dismissed", "unviewed", "unviewed"],
    ]);
  });

  test("rapid toggles send only the latest wish", async () => {
    const h = open();

    await asMona(
      h,
      GitHub.use((gh) =>
        Effect.all(
          [true, false, true, false, true].map((viewed) =>
            gh.setViewed({ pull: PR42, pullId: ID42, path: "src/webhooks/deliver.ts", viewed })
          ),
          { concurrency: "unbounded" }
        )
      )
    );

    const sent = h.fake.requests.filter((r) => r.name.endsWith("FileAsViewed"));

    expect(sent.length).toBeLessThanOrEqual(2);
    expect(h.fake.world.viewed.get(`${ID42}:mona:src/webhooks/deliver.ts`)).toBe("VIEWED");
  });
});

describe("Review Checkouts", () => {
  test("one nodes query reports open, merged and closed", async () => {
    const h = open();

    await asMona(
      h,
      GitHub.use((gh) =>
        Effect.gen(function* () {
          yield* gh.watchCheckouts([
            { key: "local:pr-42", pull: PR42, pullId: ID42 },
            { key: "local:pr-44", pull: { ...PR42, number: 44 }, pullId: "PR_kwDOacme44" },
          ]);
          yield* until(gh.checkouts, (s) => s.length === 2 && s.every((c) => c.state === "open"));
          h.fake.merge("acme/widgets", 42);
          h.fake.close("acme/widgets", 44);
          yield* h.advance(60_000);

          const states = yield* until(gh.checkouts, (s) => s.every((c) => c.state !== "open"));

          expect(states.map((s) => [s.key, s.state])).toEqual([
            ["local:pr-42", "merged"],
            ["local:pr-44", "closed"],
          ]);
        })
      )
    );

    expect(h.fake.requests.filter((r) => r.name === "PullStates").length).toBe(2);
  });
});

describe("opening a pull request", () => {
  test("as the account routed to the repository", async () => {
    const h = open();

    const created = await asMona(
      h,
      GitHub.use((gh) =>
        gh.createPull({
          repo: { owner: "mona", name: "dotfiles" },
          head: "polaris/fix-prompt",
          base: "main",
          title: "Fix the prompt",
          body: "Made in Polaris.",
          draft: false,
        })
      )
    );

    expect(created.url).toMatch(/^https:\/\/github\.com\/mona\/dotfiles\/pull\/\d+$/);
    expect(h.fake.world.pulls.at(-1)).toMatchObject({ author: "mona", title: "Fix the prompt" });
  });
});

describe("thread input", () => {
  test("a range sends startLine and startSide; one line doesn't", () => {
    expect(threadInput(line({ startLine: 28, startSide: "left" }), "R")).toMatchObject({
      line: 30,
      side: "RIGHT",
      startLine: 28,
      startSide: "LEFT",
    });
    expect(threadInput(line({ startLine: 30, startSide: "right" }), "R")).not.toHaveProperty(
      "startLine"
    );
    expect(threadProblem(line({ startLine: 40, startSide: "right" }))).toBe(
      "A range must start before it ends."
    );
  });
});
