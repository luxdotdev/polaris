import { Effect } from "effect";
import { gitText } from "../../git/git.ts";

/** A diff past this is cut; the Inspector reads the rest in the worktree. */
export const DIFF_LIMIT = 120_000;

export const cutDiff = (stat: string, patch: string, limit = DIFF_LIMIT) =>
  patch.length <= limit
    ? patch
    : [
        stat.trimEnd(),
        "",
        patch.slice(0, limit),
        `… cut after ${limit} of ${patch.length} characters; read the rest with git diff.`,
      ].join("\n");

/** The Claim's diff against its base, read where the branch is; null when it can't be read. */
export const claimDiff = (cwd: string, base: string, head: string) =>
  Effect.tryPromise(async () => {
    const range = `${base}...${head}`;
    const stat = await gitText(cwd, ["diff", "--stat", range]);
    const patch = await gitText(cwd, ["diff", range]);

    return cutDiff(stat, patch);
  }).pipe(Effect.catch(() => Effect.succeed(null)));
