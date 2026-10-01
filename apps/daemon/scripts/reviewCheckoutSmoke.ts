/**
 * End-to-end smoke test of Review Checkouts on a real Daemon, driven like a
 * Client would, against a local fake code host (no GitHub, no Harness):
 *
 *   bun --cwd apps/daemon run smoke:review
 *
 * Starts `polaris serve` with a throwaway POLARIS_HOME, connects through
 * `polaris bridge`, registers a scratch clone as a Workspace, opens a Review
 * Checkout of PR #7, force-pushes it, updates, reads `review.checkoutStatus`,
 * removes it, and checks the user's own refs never moved.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { type HostTarget, makeHostConnection, spawnTransport } from "@polaris/client";
import {
  Command,
  CommandId,
  DomainEvent,
  HostStreamItem,
  PullRequestRef,
  type ReviewCheckout,
  ReviewCheckoutId,
  ReviewSubject,
} from "@polaris/protocol";
import { Data, Effect, Option, Result, Stream } from "effect";
import { gitText, resolveCommit } from "../src/git/git.ts";
import {
  BASE_REPO,
  contributor,
  createForge,
  publishPullRequest,
  pushMain,
  userClone,
} from "../src/git/review/testing.ts";
import { commitAll, write } from "../src/git/testing.ts";

const { Ssh } = Data.taggedEnum<HostTarget>();

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

const log = (...a: ReadonlyArray<unknown>) => console.log("[smoke:review]", ...a);

const home = mkdtempSync("/tmp/pls-");

const env = { ...process.env, POLARIS_HOME: home };

const forge = await createForge();

const author = await contributor(forge, forge.mainCommits[1] ?? "main");

write(author, "feature.txt", "v1\n");

await commitAll(author, "feature v1");

const v1 = await publishPullRequest(forge, author, 7);

const user = await userClone(forge);

await pushMain(forge, "later.txt", "main moved on\n");

const originMain = await resolveCommit(user, "refs/remotes/origin/main");

const daemon = spawn("bun", [MAIN, "serve", "--foreground"], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});

let n = 0;

const cmd = () => CommandId.make(`smoke-review-${++n}`);

const checkoutId = ReviewCheckoutId.make("smoke-review-7");

const program = Effect.gen(function* () {
  yield* Effect.sleep("1 second");

  const conn = yield* makeHostConnection({
    key: "smoke",
    name: "Smoke",
    target: Ssh({ alias: "unused" }),
    identity: {
      name: "polaris-smoke",
      version: "0.0.0",
      deviceLabel: "Smoke test",
      capabilities: ["review.checkouts"],
    },
    connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
  });

  const s = yield* conn.awaitSession;

  if (!s.capabilities.includes("review.checkouts")) {
    return yield* Effect.die("the Daemon does not announce review.checkouts");
  }

  const dispatch = (command: Command) => s.client.dispatch({ commandId: cmd(), command });

  yield* dispatch(Command.cases.RegisterWorkspace.make({ path: user, name: "smoke" }));

  const snapshot = yield* s.client
    .subscribeHost({ afterSequence: null })
    .pipe(Stream.filter(HostStreamItem.guards.Snapshot), Stream.runHead);

  const workspace = Option.getOrUndefined(snapshot)?.workspaces[0];

  if (workspace === undefined) return yield* Effect.die("workspace not registered");

  /** Follow the host stream until the checkout satisfies `done` (undefined: removed). */
  const until = (label: string, done: (checkout: ReviewCheckout | undefined) => boolean) =>
    s.client.subscribeHost({ afterSequence: null }).pipe(
      Stream.filterMap((item): Result.Result<ReviewCheckout | undefined, void> => {
        if (HostStreamItem.guards.Snapshot(item)) {
          return Result.succeed(item.reviewCheckouts.find((c) => c.id === checkoutId));
        }

        if (!HostStreamItem.guards.Event(item)) return Result.failVoid;
        const event = item.envelope.event;

        if (DomainEvent.guards.ReviewCheckoutRemoved(event)) return Result.succeed(undefined);

        return DomainEvent.guards.ReviewCheckoutChanged(event) ||
          DomainEvent.guards.ReviewCheckoutOpened(event)
          ? Result.succeed(event.checkout)
          : Result.failVoid;
      }),
      Stream.tap((checkout) =>
        Effect.sync(() => log(label, checkout?.state ?? "removed", checkout?.head ?? ""))
      ),
      Stream.takeUntil(done),
      Stream.runLast,
      Effect.timeout("1 minute"),
      Effect.map(Option.getOrUndefined)
    );

  yield* dispatch(
    Command.cases.OpenReviewCheckout.make({
      checkoutId,
      workspaceId: workspace.id,
      subject: ReviewSubject.cases.PullRequest.make({
        pullRequest: new PullRequestRef({ repo: BASE_REPO, number: 7 }),
        baseRef: "main",
      }),
      head: v1,
      base: "",
    })
  );

  const ready = yield* until("open:", (c) => c?.state === "ready" || c?.state === "blocked");

  if (ready?.state !== "ready" || ready.head !== v1) return yield* Effect.die("not checked out");
  log("checked out at", ready.path);

  yield* Effect.promise(async () => {
    await gitText(author, ["reset", "-q", "--hard", "HEAD~1"]);
    write(author, "feature.txt", "v2\n");
    await commitAll(author, "feature v2");
  });
  const v2 = yield* Effect.promise(() => publishPullRequest(forge, author, 7));
  yield* dispatch(Command.cases.ReportReviewHead.make({ checkoutId, head: v2, base: "" }));
  yield* until("force-push:", (c) => c?.state === "stale");
  yield* dispatch(Command.cases.UpdateReviewCheckout.make({ checkoutId, discardChanges: false }));
  yield* until("update:", (c) => c?.state === "ready" && c.head === v2);

  const status = yield* s.client["review.checkoutStatus"]({ checkoutId });
  log("status:", JSON.stringify({ dirty: status.dirtyPaths, local: status.localCommits }));

  yield* dispatch(Command.cases.RemoveReviewCheckout.make({ checkoutId, reason: "merged" }));
  yield* until("remove:", (c) => c === undefined);

  if (existsSync(ready.path)) return yield* Effect.die("the worktree is still there");
  const after = yield* Effect.promise(() => resolveCommit(user, "refs/remotes/origin/main"));

  if (after !== originMain) return yield* Effect.die("the user's origin/main moved");
  log("the user's refs are untouched; the worktree is gone");
});

await Effect.runPromise(Effect.scoped(program)).then(
  () => log("OK"),
  (e) => {
    log("FAILED", e);
    process.exitCode = 1;
  }
);

daemon.kill("SIGTERM");

await new Promise((r) => daemon.once("exit", r));

for (const dir of [home, forge.root, dirname(user), dirname(author)]) {
  rmSync(dir, { recursive: true, force: true });
}
