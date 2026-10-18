import { describe, expect, test } from "bun:test";
import { processIdentity, ProcessIdentityUnknown, type PsRun } from "./process.ts";

const LSTART = "Sat Oct 17 21:27:36 2026";

/** Scripted `ps` runs: `null` never answers, as when Bun loses the child's exit. */
const scripted = (answers: ReadonlyArray<string | null>) => {
  const killed: number[] = [];
  let n = 0;

  const run = (): PsRun => {
    const index = n++;
    const answer = answers[index];

    return {
      output:
        answer === null || answer === undefined ? new Promise(() => {}) : Promise.resolve(answer),
      kill: () => killed.push(index),
    };
  };

  return { run, killed };
};

describe.skipIf(process.platform === "win32")("a process's identity from ps", () => {
  test("a run that never answers is killed and asked again", async () => {
    const ps = scripted([null, `Ss   ${LSTART}\n`]);

    expect(await processIdentity(42, { run: ps.run, attemptMs: 20 })).toBe(LSTART);
    expect(ps.killed).toEqual([0]);
  });

  test("when ps never answers, the identity is unknown rather than gone", async () => {
    const ps = scripted([null, null, null]);

    const [outcome] = await Promise.allSettled([
      processIdentity(42, { run: ps.run, attemptMs: 20, attempts: 3 }),
    ]);

    expect(outcome?.status === "rejected" && outcome.reason).toBeInstanceOf(ProcessIdentityUnknown);
    expect(ps.killed).toEqual([0, 1, 2]);
  });

  test("a zombie or no process at all has no identity", async () => {
    expect(await processIdentity(42, { run: scripted([`Z    ${LSTART}\n`]).run })).toBeNull();
    expect(await processIdentity(42, { run: scripted([""]).run })).toBeNull();
  });
});
