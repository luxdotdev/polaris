/** `ReviewCheckoutGit` on the Host's git (`review/`). */
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { Layer } from "effect";
import { CheckoutBlocked, ReviewCheckoutGit, ServiceError } from "../services.ts";
import { gitText } from "./git.ts";
import { finishingGit, interruptibleGit } from "./interrupt.ts";
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

/** Reads: an interrupt kills their git. */
const read = <A>(f: () => Promise<A>) => interruptibleGit({ try: f, catch: toServiceError });

/** Writes refs or a checkout: an interrupt lets their git finish first (`interrupt.ts`). */
const attempt = <A>(f: () => Promise<A>) => finishingGit({ try: f, catch: toServiceError });

const attemptBlocking = <A>(f: () => Promise<A>) =>
  finishingGit({
    try: f,
    catch: (cause) => (cause instanceof CheckoutBlocked ? cause : toServiceError(cause)),
  });

/** The main repository of a checkout, from its common git dir. */
const repoPathOf = async (path: string): Promise<string> => {
  const common = await gitText(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

  return basename(common) === ".git" ? dirname(common) : common;
};

/** `deepenSteps`: how far a shallow clone is deepened looking for a merge base (tests set it). */
export const reviewCheckoutGitLayer = (
  settings: { readonly deepenSteps?: ReadonlyArray<number> } = {}
) =>
  Layer.succeed(
    ReviewCheckoutGit,
    ReviewCheckoutGit.of({
      fetchPullRequest: (options) =>
        attemptBlocking(() =>
          fetchPullRequest(
            settings.deepenSteps === undefined
              ? options
              : { ...options, deepenSteps: settings.deepenSteps }
          )
        ),
      pinCommits: (options) => attemptBlocking(() => pinCommits(options)),
      ensure: (options) => attempt(() => ensureCheckout(options)),
      inspect: (path, head) => read(() => inspectCheckout(path, head)),
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

export const ReviewCheckoutGitLive = reviewCheckoutGitLayer();
