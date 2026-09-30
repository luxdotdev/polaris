/**
 * Every read and write the index makes, as prepared statements over the
 * cache, plus the bucket keys a pass touched (what `usage.watch` re-sends).
 */
import type { Database } from "bun:sqlite";
import type { ClaudeEntry } from "./claude.ts";

const HOUR_MS = 3_600_000;

export const hourOf = (ts: number): number => Math.floor(ts / HOUR_MS) * HOUR_MS;

/** A counted response, ready to store. */
export interface UsageRow {
  readonly harness: string;
  /** The Harness's own session id (Claude `sessionId`, Codex thread id). */
  readonly native: string;
  readonly ts: number;
  readonly model: string;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cost: number | null;
}

/** A stored Claude response, as the dedup rules compare it. */
export interface StoredClaude {
  readonly id: number;
  readonly session: string;
  readonly ts: number;
  readonly req: string | null;
  readonly sidechain: boolean;
  readonly fast: boolean;
  readonly model: string;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
}

export interface FileRecord {
  readonly path: string;
  readonly harness: string;
  readonly offset: number;
  readonly size: number;
  readonly ino: number;
  readonly state: string | null;
}

interface ClaudeRowSql {
  id: number;
  native: string;
  ts: number;
  req: string | null;
  sidechain: number;
  fast: number;
  model: string;
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
}

const toStored = (row: ClaudeRowSql): StoredClaude => ({
  id: row.id,
  session: row.native,
  ts: row.ts,
  req: row.req,
  sidechain: row.sidechain === 1,
  fast: row.fast === 1,
  model: row.model,
  input: row.input,
  cacheRead: row.cache_read,
  cacheWrite: row.cache_write,
  output: row.output,
});

/** `hour \0 harness \0 model \0 native`: one bucket before Agent Session mapping. */
export const bucketKey = (hour: number, harness: string, model: string, native: string) =>
  `${hour}\u0000${harness}\u0000${model}\u0000${native}`;

const CLAUDE_COLUMNS =
  "id, native, ts, req, sidechain, fast, model, input, cache_read, cache_write, output";

/** A bucket key under the Agent Session it had before a link moved it. */
export interface Vacated {
  readonly hour: number;
  readonly harness: string;
  readonly model: string;
  readonly sessionId: string | null;
}

export const writerOver = (db: Database) => {
  const touched = new Set<string>();
  const vacated: Array<Vacated> = [];

  const statements = {
    insert: db.query(
      `INSERT OR IGNORE INTO usage (harness, native, ts, hour, model, input, cache_read, cache_write, output, reasoning, cost, dedupe, msg, req, sidechain, fast)
       VALUES ($harness, $native, $ts, $hour, $model, $input, $cacheRead, $cacheWrite, $output, $reasoning, $cost, $dedupe, $msg, $req, $sidechain, $fast)`
    ),
    replace: db.query(
      `UPDATE usage SET native = $native, ts = $ts, hour = $hour, model = $model, input = $input, cache_read = $cacheRead,
       cache_write = $cacheWrite, output = $output, cost = $cost, req = $req, sidechain = $sidechain, fast = $fast WHERE id = $id`
    ),
    addKey: db.query("INSERT OR IGNORE INTO claude_keys (key, entry) VALUES (?, ?)"),
    byKey: db.query<ClaudeRowSql, [string]>(
      `SELECT ${CLAUDE_COLUMNS.replaceAll(/(\w+)/g, "u.$1")} FROM claude_keys k JOIN usage u ON u.id = k.entry WHERE k.key = ?`
    ),
    routes: db.query<ClaudeRowSql, [string, string, string, string]>(
      `SELECT ${CLAUDE_COLUMNS} FROM usage WHERE harness = 'claude' AND msg = ?
       AND (native = ? OR id IN (SELECT entry FROM claude_alias WHERE msg = ? AND session = ?)) ORDER BY id`
    ),
    alias: db.query("INSERT OR IGNORE INTO claude_alias (msg, session, entry) VALUES (?, ?, ?)"),
    file: db.query<FileRecord, [string]>(
      "SELECT path, harness, offset, size, ino, state FROM files WHERE path = ?"
    ),
    putFile: db.query(
      `INSERT INTO files (path, harness, offset, size, ino, state) VALUES ($path, $harness, $offset, $size, $ino, $state)
       ON CONFLICT (path) DO UPDATE SET offset = $offset, size = $size, ino = $ino, state = $state`
    ),
    appendStream: db.query(
      "INSERT OR REPLACE INTO codex_stream (file, seq, ts, usage) VALUES (?, ?, ?, ?)"
    ),
    dropStream: db.query("DELETE FROM codex_stream WHERE file = ?"),
    stream: db.query<{ ts: number | null; usage: string }, [string]>(
      "SELECT ts, usage FROM codex_stream WHERE file = ? ORDER BY seq"
    ),
    addThread: db.query("INSERT OR IGNORE INTO codex_threads (thread, file) VALUES (?, ?)"),
    link: db.query(
      `INSERT INTO session_map (harness, native, session_id) VALUES (?, ?, ?)
       ON CONFLICT (harness, native) DO UPDATE SET session_id = excluded.session_id
       WHERE session_id != excluded.session_id`
    ),
    nativeBuckets: db.query<{ hour: number; model: string }, [string, string]>(
      "SELECT DISTINCT hour, model FROM usage WHERE harness = ? AND native = ?"
    ),
    sessionOf: db.query<{ session_id: string }, [string, string]>(
      "SELECT session_id FROM session_map WHERE harness = ? AND native = ?"
    ),
    meta: db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?"),
    putMeta: db.query("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"),
    planLimits: db.query<{ value: string }, []>("SELECT value FROM plan_limits"),
    putPlanLimit: db.query("INSERT OR REPLACE INTO plan_limits (key, value) VALUES (?, ?)"),
    parentFile: db.query<{ file: string }, [string, string]>(
      "SELECT file FROM codex_threads WHERE thread = ? AND file != ? ORDER BY file LIMIT 1"
    ),
  };

  const touch = (row: { hour: number; harness: string; model: string; native: string }) =>
    touched.add(bucketKey(row.hour, row.harness, row.model, row.native));

  const claudeParams = (entry: ClaudeEntry) => ({
    native: entry.session,
    ts: entry.ts,
    hour: hourOf(entry.ts),
    model: entry.model,
    input: entry.input,
    cacheRead: entry.cacheRead,
    cacheWrite: entry.cacheWrite,
    output: entry.output,
    cost: entry.cost,
    req: entry.req,
    sidechain: entry.sidechain ? 1 : 0,
    fast: entry.fast ? 1 : 0,
  });

  return {
    touched,
    vacated,
    transaction: (body: () => void) => db.transaction(body)(),

    insertClaude: (entry: ClaudeEntry, key: string | null) => {
      const params = claudeParams(entry);

      const result = statements.insert.run({
        ...params,
        harness: "claude",
        reasoning: 0,
        dedupe: null,
        msg: entry.msg,
      });

      if (key !== null) statements.addKey.run(key, Number(result.lastInsertRowid));
      touch({ ...params, harness: "claude" });
    },

    replaceClaude: (existing: StoredClaude, entry: ClaudeEntry, key: string) => {
      const params = claudeParams(entry);
      touch({
        hour: hourOf(existing.ts),
        harness: "claude",
        model: existing.model,
        native: existing.session,
      });
      statements.replace.run({ ...params, id: existing.id });
      statements.addKey.run(key, existing.id);
      touch({ ...params, harness: "claude" });
    },

    claudeByKey: (key: string): StoredClaude | null => {
      const row = statements.byKey.get(key);

      return row === null ? null : toStored(row);
    },

    /** ccusage's sidechain replay route: a copy with a sidechain on either side. */
    claudeReplayOf: (entry: ClaudeEntry): StoredClaude | null => {
      if (entry.msg === null) return null;

      for (const row of statements.routes.all(entry.msg, entry.session, entry.msg, entry.session)) {
        const stored = toStored(row);
        const requestless = entry.req === null && stored.req === null;

        if ((entry.sidechain || stored.sidechain) && (requestless || stored.ts === entry.ts))
          return stored;
      }

      return null;
    },

    addClaudeAlias: (msg: string, session: string, entry: number) => {
      statements.alias.run(msg, session, entry);
    },

    /** A Codex response, unless the same one (time, Model, tokens) is already counted. */
    insertCodex: (row: UsageRow, dedupe: string) => {
      const hour = hourOf(row.ts);

      const result = statements.insert.run({
        ...row,
        hour,
        dedupe,
        msg: null,
        req: null,
        sidechain: 0,
        fast: 0,
      });

      if (result.changes > 0) touch({ ...row, hour });
    },

    file: (path: string) => statements.file.get(path),
    putFile: (file: FileRecord) => statements.putFile.run({ ...file }),

    appendStream: (file: string, seq: number, ts: number | null, usage: string) =>
      statements.appendStream.run(file, seq, ts, usage),
    dropStream: (file: string) => statements.dropStream.run(file),
    stream: (file: string) => statements.stream.all(file),
    addThread: (thread: string, file: string) => statements.addThread.run(thread, file),
    parentFile: (thread: string, child: string) =>
      statements.parentFile.get(thread, child)?.file ?? null,

    /** Links a Harness session id to its Agent Session; touches its buckets when that changed. */
    link: (harness: string, native: string, sessionId: string) => {
      const previous = statements.sessionOf.get(harness, native)?.session_id ?? null;

      if (statements.link.run(harness, native, sessionId).changes === 0) return;

      for (const { hour, model } of statements.nativeBuckets.all(harness, native)) {
        touch({ hour, harness, model, native });
        vacated.push({ hour, harness, model, sessionId: previous });
      }
    },
    sessionOf: (harness: string, native: string) =>
      statements.sessionOf.get(harness, native)?.session_id ?? null,

    meta: (key: string) => statements.meta.get(key)?.value ?? null,
    putMeta: (key: string, value: string) => statements.putMeta.run(key, value),
    planLimits: () => statements.planLimits.all().map((row) => row.value),
    putPlanLimit: (key: string, value: string) => statements.putPlanLimit.run(key, value),
  };
};

export type UsageWriter = ReturnType<typeof writerOver>;
