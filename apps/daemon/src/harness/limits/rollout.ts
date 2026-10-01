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

/** Rollouts tried, newest first: a session that ended before any response has no reading. */
const MAX_ROLLOUTS = 32;

/** Rollouts in the recent day directories, newest (by modification time) first. */
const recentRollouts = async (sessions: string): Promise<Array<string>> => {
  const found: Array<{ path: string; mtime: number }> = [];

  for (const dir of await recentDays(sessions)) {
    const names = (await readdir(dir).catch((): Array<string> => [])).filter(
      (n) => n.startsWith("rollout-") && n.endsWith(".jsonl")
    );

    for (const name of names) {
      const path = join(dir, name);
      const mtime = (await stat(path).catch(() => null))?.mtimeMs ?? 0;
      found.push({ path, mtime });
    }
  }

  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_ROLLOUTS)
    .map((r) => r.path);
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

/**
 * From the newest rollout that has a reading. Empty when none of the recent
 * ones has rate limits on this Host.
 */
export const latestRolloutLimits = (
  home: string = codexHome()
): Effect.Effect<ReadonlyArray<PlanLimit>> =>
  Effect.promise(async () => {
    for (const path of await recentRollouts(join(home, "sessions"))) {
      const limits = fromRolloutText(await tail(path).catch(() => ""));

      if (limits.length > 0) return limits;
    }

    return [];
  }).pipe(
    Effect.catchCause(() => Effect.succeed([])),
    Effect.withSpan("PlanLimits.codexRollout")
  );
