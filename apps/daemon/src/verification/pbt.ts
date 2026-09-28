/**
 * Shared settings for the model-based tests in this directory (ENG-209). The
 * properties they check are the ones specified in `packages/spec/polaris.qnt`.
 */

/**
 * Runs per property. CI uses the default; for a longer local run set e.g.
 * `POLARIS_PBT_RUNS=500 bun test src/verification`. `POLARIS_PBT_SEED` replays
 * a failing seed that fast-check printed.
 */
export const pbtRuns = (fallback: number): number => {
  const raw = process.env.POLARIS_PBT_RUNS;
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const pbtSeed = (): { seed: number } | Record<string, never> => {
  const raw = process.env.POLARIS_PBT_SEED;
  const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

  return Number.isFinite(n) ? { seed: n } : {};
};

/** A test timeout that grows with the number of runs. */
export const pbtTimeout = (runs: number, perRunMs: number): number =>
  Math.max(30_000, runs * perRunMs);

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait until `condition` holds, or fail with `what` after `timeoutMs`. */
export const eventually = async (
  what: string,
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await sleep(2);
  }
};

/** Is `prefix` a prefix of `list`? */
export const isPrefix = (prefix: ReadonlyArray<number>, list: ReadonlyArray<number>): boolean =>
  prefix.length <= list.length && prefix.every((x, i) => list[i] === x);
