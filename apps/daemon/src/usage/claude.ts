// Portions adapted from ccusage/ccusage@0dd85c1 (MIT): rust/adapters/claude/src/{lib,paths}.rs
/**
 * Claude Code transcripts (`<config>/projects/**\/*.jsonl`): each assistant
 * response's `message.usage`, deduplicated by ccusage's rules (see README).
 */
import { basename, dirname, join, relative, sep } from "node:path";
import { Schema } from "effect";
import type { UsageWriter } from "./writer.ts";

/** Lines without this can't carry usage; the rest are never decoded. It comes late in a line. */
export const CLAUDE_SCAN = { markers: ['"usage":{', '"usage": {'] };

const Count = Schema.Number;

const TokenUsage = Schema.Struct({
  input_tokens: Count,
  output_tokens: Count,
  cache_creation_input_tokens: Schema.optionalKey(Count),
  cache_read_input_tokens: Schema.optionalKey(Count),
  speed: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cache_creation: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        ephemeral_5m_input_tokens: Schema.optionalKey(Count),
        ephemeral_1h_input_tokens: Schema.optionalKey(Count),
      })
    )
  ),
});

type TokenUsage = typeof TokenUsage.Type;

const optionalString = Schema.optionalKey(Schema.NullOr(Schema.String));

const ClaudeLine = Schema.Struct({
  sessionId: optionalString,
  timestamp: Schema.String,
  version: optionalString,
  message: Schema.Struct({ usage: TokenUsage, model: optionalString, id: optionalString }),
  costUSD: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  requestId: optionalString,
  isSidechain: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});

type ClaudeLine = typeof ClaudeLine.Type;

const Iterations = Schema.Struct({
  message: Schema.Struct({
    usage: Schema.Struct({
      iterations: Schema.Array(
        Schema.Struct({
          type: Schema.String,
          model: optionalString,
          usage: TokenUsage,
        })
      ),
    }),
  }),
});

/** The hot path checks with `Schema.is`: decoding allocates far more per line. */
const isClaudeLine = Schema.is(ClaudeLine);

const isIterations = Schema.is(Iterations);

/** One response as the dedup rules see it. */
export interface ClaudeEntry {
  readonly msg: string | null;
  readonly req: string | null;
  /** The effective session: the line's `sessionId`, else the one its path names. */
  readonly session: string;
  readonly ts: number;
  readonly sidechain: boolean;
  readonly fast: boolean;
  readonly model: string;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly cost: number | null;
}

const cacheWrite = (usage: TokenUsage): number =>
  usage.cache_creation
    ? (usage.cache_creation.ephemeral_5m_input_tokens ?? 0) +
      (usage.cache_creation.ephemeral_1h_input_tokens ?? 0)
    : (usage.cache_creation_input_tokens ?? 0);

export const entryTotal = (
  entry: Pick<ClaudeEntry, "input" | "cacheRead" | "cacheWrite" | "output">
) => entry.input + entry.output + entry.cacheWrite + entry.cacheRead;

const SEMVER_PREFIX = /^\d+\.\d+\.\d/;

const isEmpty = (value: string | null | undefined) => value === "";

const isValid = (line: ClaudeLine): boolean =>
  !(line.version != null && !SEMVER_PREFIX.test(line.version)) &&
  !isEmpty(line.sessionId) &&
  !isEmpty(line.requestId) &&
  !isEmpty(line.message.id) &&
  !isEmpty(line.message.model);

/** The Claude session a transcript belongs to, from its path under `projects/`. */
export const pathSession = (projectsDir: string, path: string): string => {
  const parts = relative(projectsDir, path).split(sep);
  const file = basename(path, ".jsonl");

  if (parts.length === 2 && file !== "") return file;

  if (parts.length >= 4 && parts.at(-2) === "subagents") return parts.at(-3) ?? "unknown";

  return parts.at(-2) ?? "unknown";
};

const toEntry = (
  line: ClaudeLine,
  ts: number,
  session: string,
  usage: TokenUsage,
  model: string,
  msg: string | null
): ClaudeEntry => {
  const fast = usage.speed === "fast";

  return {
    msg,
    req: line.requestId ?? null,
    session,
    ts,
    sidechain: line.isSidechain === true,
    fast,
    model: fast ? `${model}-fast` : model,
    input: usage.input_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: cacheWrite(usage),
    output: usage.output_tokens,
    cost: null,
  };
};

/** Advisor iterations count separately, under their own Model and a derived message id. */
const advisorEntries = (
  iterations: typeof Iterations.Type | null,
  base: ClaudeEntry,
  line: ClaudeLine
) => {
  if (iterations === null) return [];

  return iterations.message.usage.iterations.flatMap((iteration, index) =>
    iteration.type === "advisor_message" && iteration.model
      ? [
          toEntry(
            line,
            base.ts,
            base.session,
            iteration.usage,
            iteration.model,
            base.msg === null ? null : `${base.msg}:advisor:${index}`
          ),
        ]
      : []
  );
};

/** The responses one transcript line records: none, its own, and any advisor iterations. */
export const parseClaudeLine = (text: string, fileSession: string): ReadonlyArray<ClaudeEntry> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (!isClaudeLine(parsed)) return [];
  const line = parsed;
  const ts = Date.parse(line.timestamp);

  if (Number.isNaN(ts) || !isValid(line)) return [];
  const session = line.sessionId ?? fileSession;
  const model = line.message.model;

  // `<synthetic>` marks Claude Code's own placeholder replies; they carry no tokens.
  const main =
    model === "<synthetic>"
      ? null
      : {
          ...toEntry(
            line,
            ts,
            session,
            line.message.usage,
            model ?? "unknown",
            line.message.id ?? null
          ),
          cost: line.costUSD ?? null,
        };

  const base = main ?? toEntry(line, ts, session, line.message.usage, "", line.message.id ?? null);

  const iterations = text.includes('"advisor_message"') && isIterations(parsed) ? parsed : null;

  return [...(main ? [main] : []), ...advisorEntries(iterations, base, line)];
};

/** Exact dedup key: message + request id; without a request id, also session and time. */
export const exactKey = (entry: ClaudeEntry): string | null => {
  if (entry.msg === null) return null;

  return entry.req === null
    ? `${entry.msg}\u0000\u0000${entry.session}\u0000${entry.ts}`
    : `${entry.msg}\u0000${entry.req}`;
};

/** ccusage's tie-break: a parent beats a sidechain replay, then more tokens, then fast mode. */
export const shouldReplace = (
  candidate: ClaudeEntry,
  existing: Pick<
    ClaudeEntry,
    "sidechain" | "fast" | "input" | "cacheRead" | "cacheWrite" | "output"
  >
): boolean => {
  if (candidate.sidechain !== existing.sidechain) return existing.sidechain;
  const candidateTotal = entryTotal(candidate);
  const existingTotal = entryTotal(existing);

  if (candidateTotal !== existingTotal) return candidateTotal > existingTotal;

  return candidate.fast && !existing.fast;
};

/** Adds one entry to the index, applying the dedup rules against what it already holds. */
export const recordClaudeEntry = (writer: UsageWriter, entry: ClaudeEntry): void => {
  const key = exactKey(entry);

  if (key === null) {
    writer.insertClaude(entry, null);

    return;
  }

  const existing = writer.claudeByKey(key) ?? writer.claudeReplayOf(entry);

  if (existing === null) {
    writer.insertClaude(entry, key);

    return;
  }

  if (existing.session !== entry.session && entry.msg !== null)
    writer.addClaudeAlias(entry.msg, entry.session, existing.id);

  if (shouldReplace(entry, existing)) writer.replaceClaude(existing, entry, key);
};

/** Transcript roots: `$CLAUDE_CONFIG_DIR` (comma-separated), else `~/.config/claude` and `~/.claude`. */
export const claudeRoots = (env: Readonly<Record<string, string | undefined>>, home: string) => {
  const configured = env.CLAUDE_CONFIG_DIR?.split(",")
    .map((path) => path.trim())
    .filter((path) => path !== "")
    .map((path) => (basename(path) === "projects" ? dirname(path) : path));

  const roots =
    configured && configured.length > 0
      ? configured
      : [join(env.XDG_CONFIG_HOME || join(home, ".config"), "claude"), join(home, ".claude")];

  return [...new Set(roots)].map((root) => join(root, "projects"));
};
