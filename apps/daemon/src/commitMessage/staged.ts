/**
 * What the Harness sees: the index's diff against HEAD, read on the Host and
 * cut at a byte budget, plus recent subjects as the repository's commit style.
 */
import { childEnv } from "../service/childEnv.ts";
import { baseEnv, findRepoRoot, runGitRaw } from "../git/git.ts";
import { safeArgs, safeConfigEnv } from "../git/safeConfig/index.ts";
import { gitExecutable } from "../git/executable.ts";
import { groupFor, startSignal, stopOnAbort } from "../git/interrupt.ts";

/** Enough for a good message; past it the stat still lists every file. */
export const DIFF_BUDGET = 60_000;

export const STYLE_SUBJECTS = 15;

export interface Staged {
  readonly top: string;
  readonly stat: string;
  readonly diff: string;
  readonly files: number;
  /** Files whose diff was cut or left out; 0 when the diff is whole. */
  readonly omitted: number;
  readonly subjects: ReadonlyArray<string>;
}

export type StagedResult = Staged | "not-a-repository" | "nothing-staged";

const decoder = new TextDecoder();

const diffArgs = ["diff", "--cached", "--no-color", "--no-ext-diff", "-M"];

const text = async (cwd: string, args: ReadonlyArray<string>) => {
  const result = await runGitRaw(cwd, args);

  return result.code === 0 ? decoder.decode(result.stdout) : null;
};

/** Reads at most `budget` bytes, then kills git: a huge diff is never read in full. */
export const boundedDiff = async (top: string, budget: number) => {
  const signal = startSignal(diffArgs);

  const proc = Bun.spawn([gitExecutable(), ...safeArgs(diffArgs)], {
    ...groupFor(signal),
    cwd: top,
    env: childEnv({ ...baseEnv(), ...(await safeConfigEnv(top, baseEnv(), { args: diffArgs })) }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });

  stopOnAbort(proc, signal);
  const chunks: Array<Uint8Array> = [];
  let kept = 0;
  let truncated = false;

  for await (const chunk of proc.stdout) {
    chunks.push(chunk.subarray(0, budget - kept));
    kept += Math.min(chunk.length, budget - kept);

    if (kept >= budget) {
      truncated = true;
      proc.kill();
      break;
    }
  }

  await proc.exited;

  return { diff: decoder.decode(Buffer.concat(chunks)), truncated };
};

const fileHeaders = (diff: string) => diff.match(/^diff --git /gmu)?.length ?? 0;

export const readStaged = async (
  cwd: string,
  budget: number = DIFF_BUDGET
): Promise<StagedResult> => {
  const top = await findRepoRoot(cwd);

  if (top === null) return "not-a-repository";
  const names = await text(top, ["diff", "--cached", "--name-only", "-z", "-M"]);

  if (names === null) return "not-a-repository";
  const files = names.split("\0").filter((name) => name !== "").length;

  if (files === 0) return "nothing-staged";

  const [stat, bounded, log] = await Promise.all([
    text(top, [...diffArgs, "--stat=120", "--summary"]),
    boundedDiff(top, budget),
    text(top, ["log", `-n${STYLE_SUBJECTS}`, "--no-merges", "--format=%s"]),
  ]);

  const shown = fileHeaders(bounded.diff);

  return {
    top,
    stat: stat ?? "",
    diff: bounded.diff,
    files,
    omitted: bounded.truncated ? Math.max(1, files - shown + 1) : 0,
    subjects: (log ?? "").split("\n").filter((subject) => subject.trim() !== ""),
  };
};
