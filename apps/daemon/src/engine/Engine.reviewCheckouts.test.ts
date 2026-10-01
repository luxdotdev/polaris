/**
 * Review Checkouts end to end: the engine's commands and reactors with the
 * real `ReviewCheckoutGit` over scratch repositories (a local code host with
 * `refs/pull/<n>/head`, a user clone). The Harness is fake.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  Command,
  PullRequestRef,
  type ReviewCheckout,
  ReviewCheckoutBlock,
  ReviewCheckoutBlocker,
  ReviewCheckoutId,
  ReviewSubject,
  SessionId,
  SessionPlacement,
  type Workspace,
} from "@polaris/protocol";
import { Effect, type Layer } from "effect";
import { gitText, resolveCommit } from "../git/git.ts";
import { ReviewCheckoutGitLive } from "../git/ReviewCheckoutGit.ts";
import { reviewRef } from "../git/review/refs.ts";
import {
  BASE_REPO,
  contributor,
  type Forge,
  createForge,
  publishPullRequest,
  userClone,
} from "../git/review/testing.ts";
import { commitAll, removeDir, write } from "../git/testing.ts";
import { listWorktrees } from "../git/WorktreeTracker.ts";
import { EventStore } from "../store/EventStore.ts";
import type { ReadModel } from "../store/model.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  completesTurns,
  engineLayer,
  makeFakeDriver,
  makeFakes,
  pendingReviewCheckoutGit,
  tempDir,
  waitFor,
} from "./testing.ts";

type Env = Engine | EventStore;

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

/** The engine with the real Review Checkout git, or (`pending`) one that never finishes a fetch. */
const layerOver = (filename: string, git: "live" | "pending" = "live") =>
  engineLayer({
    filename,
    fakes: makeFakes(),
    drivers: [makeFakeDriver("claude", { onTurn: completesTurns() })],
    reviewCheckoutGit: git === "live" ? ReviewCheckoutGitLive : pendingReviewCheckoutGit,
  });

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const checkoutId = ReviewCheckoutId.make("rc-7");

const subject = ReviewSubject.cases.PullRequest.make({
  pullRequest: new PullRequestRef({ repo: BASE_REPO, number: 7 }),
  baseRef: "main",
});

const checkoutOf = (model: ReadModel): ReviewCheckout | undefined =>
  model.reviewCheckouts.get(checkoutId);

const until = (predicate: (checkout: ReviewCheckout | undefined) => boolean) =>
  Effect.map(
    waitFor((model) => predicate(checkoutOf(model)), 15_000),
    (model) => checkoutOf(model)
  );

const inState = (state: ReviewCheckout["state"]) => until((checkout) => checkout?.state === state);

const registerWorkspace = (path: string) =>
  Effect.gen(function* () {
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === path));

    return [...model.workspaces.values()].find((w) => w.path === path)!;
  });

const openPr = (workspace: Workspace, head: string, base: string) =>
  dispatch(
    Command.cases.OpenReviewCheckout.make({
      checkoutId,
      workspaceId: workspace.id,
      subject,
      head,
      base,
    })
  );

/** A code host with PR #7 (one commit on main~1) and a user clone registered as a Workspace. */
const scenario = async (options: { readonly depth?: number } = {}) => {
  const forge = await createForge();
  const author = await contributor(forge, forge.mainCommits[1] ?? "main");
  write(author, "feature.txt", "v1\n");
  await commitAll(author, "feature v1");
  const v1 = await publishPullRequest(forge, author, 7);
  const user = await userClone(forge, options);
  cleanup.push(forge.root, user, `${user}.worktrees`);

  return { forge, author, user, v1 };
};

const forcePush = async (forge: Forge, author: string, content: string) => {
  await gitText(author, ["reset", "-q", "--hard", "HEAD~1"]);
  write(author, "feature.txt", content);
  await commitAll(author, `feature: ${content.trim()}`);

  return publishPullRequest(forge, author, 7);
};

const blockOf = (checkout: ReviewCheckout | undefined) => checkout?.blocked;

describe("Review Checkouts on the Host", () => {
  test("open fetches and checks out; a force-push makes it stale and an update moves it", async () => {
    const s = await scenario();
    await run(
      layerOver(join(tempDir(), "state.sqlite")),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(s.user);
        yield* openPr(workspace, s.v1, "");

        const ready = yield* inState("ready");
        expect(ready).toMatchObject({ head: s.v1, mergeBase: s.forge.mainCommits[1] });
        expect(ready?.path).toBe(join(workspace.worktreeRoot, ".review", "pr-7"));
        const listed = yield* Effect.promise(() => listWorktrees(s.user));
        expect(listed.find((w) => w.path === ready?.path)).toMatchObject({
          branch: null,
          head: s.v1,
          lockReason: `polaris review checkout ${workspace.id} acme/app#7`,
        });
        // The engine's Worktrees never see it as a Worktree.
        expect([...(yield* (yield* EventStore).model).worktrees.values()]).toEqual([]);

        const v2 = yield* Effect.promise(() => forcePush(s.forge, s.author, "v2\n"));
        yield* dispatch(Command.cases.ReportReviewHead.make({ checkoutId, head: v2, base: "" }));
        yield* inState("stale");

        yield* dispatch(
          Command.cases.UpdateReviewCheckout.make({ checkoutId, discardChanges: false })
        );
        const moved = yield* until((c) => c?.state === "ready" && c.head === v2);
        expect(yield* Effect.promise(() => resolveCommit(moved?.path ?? "", "HEAD"))).toBe(v2);
      })
    );
  }, 30_000);

  test("an update of a dirty checkout is blocked until the user discards the edits", async () => {
    const s = await scenario();
    await run(
      layerOver(join(tempDir(), "state.sqlite")),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(s.user);
        yield* openPr(workspace, s.v1, "");
        const ready = yield* inState("ready");
        write(ready?.path ?? "", "feature.txt", "my local edit\n");
        const v2 = yield* Effect.promise(() => forcePush(s.forge, s.author, "v2\n"));
        yield* dispatch(Command.cases.ReportReviewHead.make({ checkoutId, head: v2, base: "" }));

        yield* dispatch(
          Command.cases.UpdateReviewCheckout.make({ checkoutId, discardChanges: false })
        );
        const blocked = yield* inState("blocked");
        expect(blockOf(blocked)).toEqual(
          new ReviewCheckoutBlock({
            during: "update",
            blocker: ReviewCheckoutBlocker.cases.Dirty.make({ paths: ["feature.txt"] }),
          })
        );
        expect(blocked?.head).toBe(s.v1);

        yield* dispatch(
          Command.cases.UpdateReviewCheckout.make({ checkoutId, discardChanges: true })
        );
        yield* until((c) => c?.state === "ready" && c.head === v2);
      })
    );
  }, 30_000);

  test("removal is blocked by commits of its own, then removes the worktree and its refs", async () => {
    const s = await scenario();
    await run(
      layerOver(join(tempDir(), "state.sqlite")),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(s.user);
        yield* openPr(workspace, s.v1, "");
        const ready = yield* inState("ready");
        const path = ready?.path ?? "";
        write(path, "fix.txt", "a fix\n");
        const local = yield* Effect.promise(() => commitAll(path, "a local fix"));

        yield* dispatch(Command.cases.RemoveReviewCheckout.make({ checkoutId, reason: "merged" }));
        const blocked = yield* inState("blocked");
        expect(blockOf(blocked)).toEqual(
          new ReviewCheckoutBlock({
            during: "remove",
            blocker: ReviewCheckoutBlocker.cases.LocalCommits.make({ count: 1 }),
          })
        );

        const engine = yield* Engine;
        const status = yield* engine.checkoutStatus(checkoutId);
        expect(status).toMatchObject({ dirtyPaths: [], localCommits: 1, sessionsInside: [] });

        // The user keeps the commit on a branch of their own; then removal goes ahead.
        yield* Effect.promise(() => gitText(s.user, ["branch", "keep-fix", local]));
        yield* dispatch(Command.cases.RemoveReviewCheckout.make({ checkoutId, reason: "user" }));
        yield* until((c) => c === undefined);
        expect(existsSync(path)).toBe(false);
        expect(
          yield* Effect.promise(() => resolveCommit(s.user, reviewRef("7", "head")))
        ).toBeNull();
      })
    );
  }, 30_000);

  test("a missing pull request blocks the fetch with a message", async () => {
    const s = await scenario();
    await run(
      layerOver(join(tempDir(), "state.sqlite")),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(s.user);
        yield* dispatch(
          Command.cases.OpenReviewCheckout.make({
            checkoutId,
            workspaceId: workspace.id,
            subject: ReviewSubject.cases.PullRequest.make({
              pullRequest: new PullRequestRef({ repo: BASE_REPO, number: 99 }),
              baseRef: "main",
            }),
            head: "abc",
            base: "",
          })
        );

        expect(blockOf(yield* inState("blocked"))).toEqual(
          new ReviewCheckoutBlock({
            during: "fetch",
            blocker: ReviewCheckoutBlocker.cases.FetchFailed.make({
              message: "pull request #99 was not found on acme/app",
            }),
          })
        );
      })
    );
  }, 30_000);

  test("a shallow clone is reported, and an update then fetches full history", async () => {
    const s = await scenario({ depth: 1 });
    await run(
      layerOver(join(tempDir(), "state.sqlite")),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(s.user);
        yield* openPr(workspace, s.v1, "");

        expect(blockOf(yield* inState("blocked"))?.blocker).toEqual(
          ReviewCheckoutBlocker.cases.ShallowClone.make({})
        );

        yield* dispatch(
          Command.cases.UpdateReviewCheckout.make({ checkoutId, discardChanges: false })
        );
        yield* inState("ready");
        expect(
          yield* Effect.promise(() => gitText(s.user, ["rev-parse", "--is-shallow-repository"]))
        ).toBe("false");
      })
    );
  }, 30_000);

  test("a restart finishes a fetch the last run left in flight", async () => {
    const s = await scenario();
    const filename = join(tempDir(), "state.sqlite");
    await run(
      layerOver(filename, "pending"),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(s.user);
        yield* openPr(workspace, s.v1, "");
        yield* inState("fetching");
      })
    );

    await run(
      layerOver(filename),
      Effect.gen(function* () {
        expect(yield* inState("ready")).toMatchObject({ head: s.v1 });
      })
    );
  }, 30_000);

  test("a removed Workspace's checkouts are removed with it", async () => {
    const s = await scenario();
    await run(
      layerOver(join(tempDir(), "state.sqlite")),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(s.user);
        yield* openPr(workspace, s.v1, "");
        const path = (yield* inState("ready"))?.path ?? "";

        yield* dispatch(Command.cases.RemoveWorkspace.make({ workspaceId: workspace.id }));
        yield* until((c) => c === undefined);
        expect(existsSync(path)).toBe(false);
      })
    );
  }, 30_000);

  test("an Agent Session's Turns are checked out from their checkpoints", async () => {
    const s = await scenario();
    const sessionId = SessionId.make("s-review");
    const id = ReviewCheckoutId.make("rc-session");
    await run(
      layerOver(join(tempDir(), "state.sqlite")),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(s.user);
        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId,
            workspaceId: workspace.id,
            harness: "claude",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "turn 0",
            attachments: [],
          })
        );
        const model = yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");
        const turn = model.sessions.get(sessionId)?.turns[0];
        const before = s.forge.mainCommits[1] ?? "";
        const after = s.forge.mainCommits[2] ?? "";
        yield* Effect.promise(async () => {
          await gitText(s.user, ["update-ref", turn?.checkpointBefore ?? "", before]);
          await gitText(s.user, ["update-ref", turn?.checkpointAfter ?? "", after]);
        });

        yield* dispatch(
          Command.cases.OpenReviewCheckout.make({
            checkoutId: id,
            workspaceId: workspace.id,
            subject: ReviewSubject.cases.SessionTurns.make({
              sessionId,
              firstTurnId: null,
              lastTurnId: null,
            }),
            head: null,
            base: null,
          })
        );

        const ready = yield* waitFor((m) => m.reviewCheckouts.get(id)?.state === "ready", 15_000);
        expect(ready.reviewCheckouts.get(id)).toMatchObject({
          head: after,
          mergeBase: before,
          latestHead: after,
          path: join(workspace.worktreeRoot, ".review", `session-${sessionId}`),
        });
        // Pinned by the review's own refs, whatever checkpoint pruning does.
        expect(
          yield* Effect.promise(() =>
            resolveCommit(s.user, reviewRef(`session-${sessionId}`, "head"))
          )
        ).toBe(after);
      })
    );
  }, 30_000);
});
