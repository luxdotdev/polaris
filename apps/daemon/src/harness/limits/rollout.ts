/**
 * The last Codex Plan Limits written to Codex's own rollout logs
 * (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`): the value to show
 * before any Codex session runs in this Daemon. Read once, on demand.
 */
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PlanLimit } from "@polaris/protocol";
import { Effect } from "effect";
import { fromRolloutText } from "./codex.ts";

/** Day directories searched, newest first: a session started days ago may still be the latest. */
const DAYS = 7;

/** Bytes read from the end of the file; a `token_count` event follows every model response. */
const TAIL = 512 * 1024;

const sortedDesc = async (dir: string) =>
  (await readdir(dir).catch((): Array<string> => []))
    .filter((n) => /^\d+$/.test(n))
    .sort()
    .reverse();

/** The newest day directories under `sessions/`, newest first. */
const recentDays = async (sessions: string): Promise<Array<string>> => {
  const days: Array<string> = [];

  for (const year of await sortedDesc(sessions))
    for (const month of await sortedDesc(join(sessions, year)))
      for (const day of await sortedDesc(join(sessions, year, month))) {
        days.push(join(sessions, year, month, day));

        if (days.length === DAYS) return days;
      }

  return days;
};

const newestRollout = async (sessions: string): Promise<string | null> => {
  let newest: { path: string; mtime: number } | null = null;

  for (const dir of await recentDays(sessions)) {
    const names = (await readdir(dir).catch((): Array<string> => [])).filter(
      (n) => n.startsWith("rollout-") && n.endsWith(".jsonl")
    );

    for (const name of names) {
      const path = join(dir, name);
      const mtime = (await stat(path).catch(() => null))?.mtimeMs ?? 0;

      if (newest === null || mtime > newest.mtime) newest = { path, mtime };
    }
  }

  return newest?.path ?? null;
};

const tail = async (path: string): Promise<string> => {
  const file = await open(path, "r");

  try {
    const { size } = await file.stat();
    const length = Math.min(size, TAIL);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);

    return buffer.toString("utf8");
  } finally {
    await file.close();
  }
};

/** `CODEX_HOME`, else `~/.codex`, as Codex resolves it. */
export const codexHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.CODEX_HOME || join(env.HOME ?? homedir(), ".codex");

/** Empty when Codex has no rollout with rate limits on this Host. */
export const latestRolloutLimits = (
  home: string = codexHome()
): Effect.Effect<ReadonlyArray<PlanLimit>> =>
  Effect.promise(async () => {
    const path = await newestRollout(join(home, "sessions"));

    return path === null ? [] : fromRolloutText(await tail(path));
  }).pipe(
    Effect.catchCause(() => Effect.succeed([])),
    Effect.withSpan("PlanLimits.codexRollout")
  );
