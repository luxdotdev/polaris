/**
 * One indexing pass: find the Harness logs, and read only what was appended
 * to each since the last pass (by byte offset). A file that shrank or was
 * replaced (new inode) is read again from the start; dedup keeps that safe.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { Option } from "effect";
import {
  CLAUDE_SCAN,
  type ClaudeEntry,
  claudeRoots,
  parseClaudeLine,
  pathSession,
  recordClaudeEntry,
} from "./claude.ts";
import {
  type CodexState,
  decodeCodexState,
  encodeCodexState,
  indexCodexFile,
  newCodexState,
} from "./codex.ts";
import { scanLines, writeInSlices } from "./scan.ts";
import type { UsageWriter } from "./writer.ts";

export type UsageHarness = "claude" | "codex";

export type Env = Readonly<Record<string, string | undefined>>;

export interface LogFile {
  readonly harness: UsageHarness;
  readonly path: string;
  /** Claude: the `projects/` root it is under. Codex: its `sessions/` or `archived_sessions/`. */
  readonly root: string;
}

const jsonlUnder = (root: string): Array<string> => {
  if (!existsSync(root)) return [];

  try {
    return readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(root, name));
  } catch {
    return [];
  }
};

const home = (env: Env) => env.HOME || homedir();

export const codexHome = (env: Env) => env.CODEX_HOME || join(home(env), ".codex");

/** Every log file of each Harness, in ccusage's order (by path). */
export const discoverLogs = (env: Env, harnesses: ReadonlyArray<UsageHarness>): Array<LogFile> => {
  const files: Array<LogFile> = [];

  if (harnesses.includes("claude")) {
    for (const root of claudeRoots(env, home(env)))
      for (const path of jsonlUnder(root)) files.push({ harness: "claude", path, root });
  }

  if (harnesses.includes("codex")) {
    const sessions = join(codexHome(env), "sessions");
    const archived = join(codexHome(env), "archived_sessions");
    const active = jsonlUnder(sessions);
    const activeRelative = new Set(active.map((path) => relative(sessions, path)));

    for (const path of active) files.push({ harness: "codex", path, root: sessions });

    // The same rollout in both: the active copy wins.
    for (const path of jsonlUnder(archived))
      if (!activeRelative.has(relative(archived, path)))
        files.push({ harness: "codex", path, root: archived });
  }

  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
};

const indexClaudeFile = async (
  writer: UsageWriter,
  file: LogFile,
  offset: number,
  size: number
) => {
  const session = pathSession(file.root, file.path);
  const entries: Array<ClaudeEntry> = [];

  const scanned = await scanLines(file.path, offset, size, CLAUDE_SCAN, (line) => {
    entries.push(...parseClaudeLine(line, session));

    return false;
  });

  await writeInSlices(entries, writer.transaction, (entry) => recordClaudeEntry(writer, entry));

  return scanned.offset;
};

const codexState = async (file: LogFile, state: string | null): Promise<CodexState> => {
  const saved = state === null ? Option.none() : decodeCodexState(state);

  return Option.isSome(saved)
    ? saved.value
    : newCodexState(file.path, relative(file.root, file.path).replace(/\.jsonl$/, ""));
};

/** Brings one file up to date. Returns how many bytes it read. */
export const indexFile = async (writer: UsageWriter, file: LogFile): Promise<number> => {
  let stat;

  try {
    stat = statSync(file.path);
  } catch {
    return 0;
  }

  const record = writer.file(file.path);
  const restarted = record === null || record.ino !== stat.ino || stat.size < record.offset;

  if (!restarted && stat.size === record.size) return 0;
  const from = restarted ? 0 : record.offset;

  if (file.harness === "claude") {
    const offset = await indexClaudeFile(writer, file, from, stat.size);
    writer.putFile({
      path: file.path,
      harness: "claude",
      offset,
      size: stat.size,
      ino: stat.ino,
      state: null,
    });

    return stat.size - from;
  }

  if (restarted) writer.dropStream(file.path);
  const state = await codexState(file, restarted ? null : record.state);
  const offset = await indexCodexFile(writer, file.path, from, stat.size, state);
  writer.putFile({
    path: file.path,
    harness: "codex",
    offset,
    size: stat.size,
    ino: stat.ino,
    state: encodeCodexState(state),
  });

  return stat.size - from;
};

/** Default garbage cadence: a first build of gigabytes of logs then peaks near 150 MiB. */
export const GC_EVERY_BYTES = 64 * 1024 * 1024;

/** Brings every file up to date, collecting garbage every `gcEveryBytes` read (Pi 4 memory). */
export const indexLogs = async (
  writer: UsageWriter,
  files: ReadonlyArray<LogFile>,
  gcEveryBytes = GC_EVERY_BYTES,
  /** Called after each file, e.g. to report progress. */
  afterFile: () => void = () => {}
): Promise<number> => {
  let total = 0;
  let sinceGc = 0;

  for (const file of files) {
    const read = await indexFile(writer, file);
    total += read;
    sinceGc += read;

    if (sinceGc >= gcEveryBytes) {
      Bun.gc(true);
      sinceGc = 0;
    }

    afterFile();
  }

  return total;
};
