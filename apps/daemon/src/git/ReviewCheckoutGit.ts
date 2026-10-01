/** `ReviewCheckoutGit` on the Host's git (`review/`). */
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { Effect, Layer } from "effect";
import { CheckoutBlocked, ReviewCheckoutGit, ServiceError } from "../services.ts";
import { gitText } from "./git.ts";
import {
  ensureCheckout,
  fetchPullRequest,
  inspectCheckout,
  interdiff,
  markReviewed,
  moveCheckout,
  pinCommits,
  removeCheckout,
} from "./review/index.ts";

const toServiceError = (cause: unknown) =>
  new ServiceError({
    service: "ReviewCheckoutGit",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const attempt = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: toServiceError });

const attemptBlocking = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (cause) => (cause instanceof CheckoutBlocked ? cause : toServiceError(cause)),
  });

/** The main repository of a checkout, from its common git dir. */
const repoPathOf = async (path: string): Promise<string> => {
  const common = await gitText(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

  return basename(common) === ".git" ? dirname(common) : common;
};

export const ReviewCheckoutGitLive = Layer.succeed(
  ReviewCheckoutGit,
  ReviewCheckoutGit.of({
    fetchPullRequest: (options) => attemptBlocking(() => fetchPullRequest(options)),
    pinCommits: (options) => attemptBlocking(() => pinCommits(options)),
    ensure: (options) => attempt(() => ensureCheckout(options)),
    inspect: (path, head) => attempt(() => inspectCheckout(path, head)),
    move: (options) => attempt(() => moveCheckout(options)),
    remove: ({ repoPath, path, key }) =>
      attempt(async () => {
        if (repoPath === null && !existsSync(path)) return;
        const repo = repoPath ?? (await repoPathOf(path));
        await removeCheckout({ repoPath: repo, path, key });
      }),
    markReviewed: (options) => attempt(() => markReviewed(options)),
    interdiff: (input) => attempt(() => interdiff(input)),
  })
);
