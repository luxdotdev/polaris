/** The Quint side of the replay tests: each trace becomes runs that `quint test` checks. */
import { expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { constellationTraceToQuint, type ConstellationTrace } from "./index.ts";

const spec = join(import.meta.dir, "../..");

/**
 * True when Quint's `replayTest` passes, false only when `safety` fails on a replayed batch
 * (QNT508); a parse, type or other Quint error throws with Quint's output.
 */
const verdict = (main: string, exitCode: number | null, stdout: string, stderr: string) => {
  if (exitCode === 0) return true;

  const rejected =
    exitCode === 1 &&
    stdout.includes("1) replayTest failed") &&
    stdout.includes("Error [QNT508]: Expect condition does not hold true");

  if (rejected) return false;
  throw new Error(`quint test ${main} did not replay (exit ${exitCode}):\n${stderr}\n${stdout}`);
};

// The child's limit starts once a pool slot is held, so it is what catches a stuck check.
const CHECK_LIMIT_MS = 120_000;

// Each `quint test` is a CPU-bound Node process, so concurrent checks share a bounded pool.
let free = Math.max(2, Math.floor(navigator.hardwareConcurrency / 2));

const queue: Array<() => void> = [];

export const pooled = async <A>(task: () => Promise<A>): Promise<A> => {
  if (free > 0) free--;
  else await new Promise<void>((resume) => queue.push(resume));

  try {
    return await task();
  } finally {
    const next = queue.shift();

    if (next) next();
    else free++;
  }
};

const replay = (path: string, main: string) =>
  pooled(async () => {
    const child = Bun.spawn(
      [
        join(spec, "node_modules/.bin/quint"),
        "test",
        path,
        `--main=${main}`,
        "--backend=typescript",
      ],
      { stdout: "pipe", stderr: "pipe", timeout: CHECK_LIMIT_MS }
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    return verdict(main, exitCode, stdout, stderr);
  });

export const check = async (input: ConstellationTrace): Promise<boolean> => {
  const root = mkdtempSync(join(tmpdir(), "polaris-replay-test-"));

  try {
    const sources = constellationTraceToQuint(
      "check",
      input,
      relative(root, join(spec, "constellations"))
    );

    const verdicts = await Promise.allSettled(
      sources.map((source) => {
        const path = join(root, `${source.name}.qnt`);
        writeFileSync(path, source.source);

        return replay(path, source.name);
      })
    );

    let conforms = true;

    for (const result of verdicts) {
      if (result.status === "rejected") throw result.reason;
      conforms &&= result.value;
    }

    return conforms;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

/** Replays the labelled traces concurrently and expects each label's verdict. */
export const expectVerdicts = async (
  cases: ReadonlyArray<readonly [label: string, input: ConstellationTrace, conforms: boolean]>
) => {
  const verdicts = await Promise.all(cases.map(([, input]) => check(input)));

  expect(Object.fromEntries(cases.map(([label], index) => [label, verdicts[index]]))).toEqual(
    Object.fromEntries(cases.map(([label, , conforms]) => [label, conforms]))
  );
};
