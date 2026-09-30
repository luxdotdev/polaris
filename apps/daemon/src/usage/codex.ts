// Portions adapted from ccusage/ccusage@0dd85c1 (MIT): rust/adapters/codex/src/{parser,replay,loader,types}.rs
/**
 * Codex rollouts (`$CODEX_HOME/sessions/**\/rollout-*.jsonl`, `archived_sessions/`):
 * `token_count` events, turned into per-response deltas, with a forked or
 * subagent thread's replayed parent history skipped (see README).
 */
import { Option, Schema, type Types } from "effect";
import { firstLine, scanLines } from "./scan.ts";
import type { UsageWriter } from "./writer.ts";

/** Codex writes compact JSON; history quoted inside another line has escaped quotes and won't match. */
export const CODEX_SCAN = {
  markers: ['"type":"token_count"', '"type":"turn_context"'],
  // Both types sit in a line's first few hundred bytes.
  markerWithin: 64 * 1024,
};

/** Two usage events this close together at a fork's head are a replay, not new work. */
const REWRITTEN_BURST_PAUSE_MS = 1_000;

/** Codex's own token fields, normalized (cached and written input are part of `input`). */
export interface RawUsage {
  readonly input: number;
  readonly cached: number;
  readonly cacheCreation: number;
  readonly output: number;
  readonly reasoning: number;
  readonly total: number;
}

const isFinite = Schema.is(Schema.Finite);

const isString = Schema.is(Schema.String);

/** ccusage's lossy count: a non-negative number, or a string holding one. */
const count = (...values: ReadonlyArray<number | string | null | undefined>): number | null => {
  for (const value of values) {
    const number = isString(value) && value.trim() !== "" ? Number(value) : value;

    if (isFinite(number) && number >= 0) return Math.floor(number);
  }

  return null;
};

/** A count as Codex (and older builds) wrote it: a number, or a number in a string. */
const LooseCount = Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.Number, Schema.String])));

const UsageFields = Schema.Struct({
  input_tokens: LooseCount,
  prompt_tokens: LooseCount,
  input: LooseCount,
  cached_input_tokens: LooseCount,
  cache_read_input_tokens: LooseCount,
  cached_tokens: LooseCount,
  cache_write_input_tokens: LooseCount,
  cache_creation_input_tokens: LooseCount,
  output_tokens: LooseCount,
  completion_tokens: LooseCount,
  output: LooseCount,
  reasoning_output_tokens: LooseCount,
  reasoning_tokens: LooseCount,
  total_tokens: LooseCount,
});

type UsageFields = typeof UsageFields.Type;

/** ccusage's field aliases, clamping cached and written input to what fits in `input`. */
const toRawUsage = (fields: UsageFields): RawUsage => {
  const input = count(fields.input_tokens, fields.prompt_tokens, fields.input) ?? 0;
  const output = count(fields.output_tokens, fields.completion_tokens, fields.output) ?? 0;

  const cached = Math.min(
    count(fields.cached_input_tokens, fields.cache_read_input_tokens, fields.cached_tokens) ?? 0,
    input
  );

  const cacheCreation = Math.min(
    count(fields.cache_write_input_tokens, fields.cache_creation_input_tokens) ?? 0,
    input - cached
  );

  const total = count(fields.total_tokens);

  return {
    input,
    cached,
    cacheCreation,
    output,
    reasoning: count(fields.reasoning_output_tokens, fields.reasoning_tokens) ?? 0,
    total: total !== null && total > 0 ? total : input + output,
  };
};

const ModelFields = {
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  metadata: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ model: Schema.optionalKey(Schema.NullOr(Schema.String)) }))
  ),
};

const CodexLine = Schema.Struct({
  type: Schema.String,
  timestamp: Schema.optionalKey(Schema.NullOr(Schema.String)),
  payload: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        type: Schema.optionalKey(Schema.NullOr(Schema.String)),
        ...ModelFields,
        info: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              total_token_usage: Schema.optionalKey(Schema.NullOr(UsageFields)),
              last_token_usage: Schema.optionalKey(Schema.NullOr(UsageFields)),
              ...ModelFields,
            })
          )
        ),
      })
    )
  ),
});

type ModelSource = {
  readonly model?: string | null;
  readonly model_name?: string | null;
  readonly metadata?: { readonly model?: string | null } | null;
};

const isCodexLine = Schema.is(CodexLine);

/** The hot path checks with `Schema.is`: decoding allocates far more per line. */
const parseLine = (text: string): typeof CodexLine.Type | null => {
  try {
    const value: unknown = JSON.parse(text);

    return isCodexLine(value) ? value : null;
  } catch {
    return null;
  }
};

const SessionMeta = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literal("session_meta"),
    timestamp: Schema.optionalKey(Schema.NullOr(Schema.String)),
    payload: Schema.Struct({
      id: Schema.optionalKey(Schema.NullOr(Schema.String)),
      forked_from_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
      source: Schema.optionalKey(Schema.Unknown),
    }),
  })
);

const SubagentSource = Schema.Struct({
  subagent: Schema.Struct({
    thread_spawn: Schema.Struct({ parent_thread_id: Schema.String }),
  }),
});

const decodeMeta = Schema.decodeUnknownOption(SessionMeta);

const decodeSubagent = Schema.decodeUnknownOption(SubagentSource);

const RawUsageSchema = Schema.Struct({
  input: Schema.Number,
  cached: Schema.Number,
  cacheCreation: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  total: Schema.Number,
});

const Replay = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("matching"), index: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("burst"), last: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("done") }),
]);

type Replay = typeof Replay.Type;

/** Where a rollout's parser stopped: persisted with the file's offset. */
const CodexState = Schema.Struct({
  seq: Schema.Number,
  previous: Schema.NullOr(RawUsageSchema),
  model: Schema.NullOr(Schema.String),
  thread: Schema.String,
  parent: Schema.NullOr(Schema.String),
  forkedAt: Schema.NullOr(Schema.Number),
  replay: Replay,
});

/** Mutable: the visitor updates it line by line. */
export type CodexState = Types.Mutable<typeof CodexState.Type>;

const CodexStateJson = Schema.fromJsonString(CodexState);

export const decodeCodexState = Schema.decodeUnknownOption(CodexStateJson);

export const encodeCodexState = Schema.encodeSync(CodexStateJson);

const decodeStreamUsage = Schema.decodeUnknownOption(Schema.fromJsonString(RawUsageSchema));

const encodeStreamUsage = Schema.encodeSync(Schema.fromJsonString(RawUsageSchema));

const nonEmpty = (value: string | null | undefined): string | null => {
  const text = value?.trim();

  return text ? text : null;
};

const modelOf = (source: ModelSource | null | undefined): string | null =>
  source
    ? (nonEmpty(source.model) ?? nonEmpty(source.model_name) ?? nonEmpty(source.metadata?.model))
    : null;

const subtract = (current: RawUsage, previous: RawUsage | null): RawUsage => {
  const minus = (key: keyof RawUsage) => Math.max(0, current[key] - (previous?.[key] ?? 0));
  const input = minus("input");
  const cached = Math.min(minus("cached"), input);

  return {
    input,
    cached,
    cacheCreation: Math.min(minus("cacheCreation"), input - cached),
    output: minus("output"),
    reasoning: minus("reasoning"),
    total: minus("total"),
  };
};

const sameUsage = (a: RawUsage, b: RawUsage) =>
  a.input === b.input &&
  a.cached === b.cached &&
  a.cacheCreation === b.cacheCreation &&
  a.output === b.output &&
  a.reasoning === b.reasoning &&
  a.total === b.total;

const isZero = (usage: RawUsage) =>
  usage.input === 0 &&
  usage.cached === 0 &&
  usage.cacheCreation === 0 &&
  usage.output === 0 &&
  usage.reasoning === 0;

/** A rollout's thread, the thread it forked from, and when (from `session_meta`). */
export const readSessionMeta = async (path: string, fallbackThread: string) => {
  const line = await firstLine(path);
  const meta = line === null ? Option.none() : decodeMeta(line);

  if (Option.isNone(meta)) return { thread: fallbackThread, parent: null, forkedAt: null };
  const { payload, timestamp } = meta.value;
  const subagent = Option.getOrNull(decodeSubagent(payload.source));

  const parent =
    nonEmpty(payload.forked_from_id) ?? nonEmpty(subagent?.subagent.thread_spawn.parent_thread_id);

  const forkedAt = timestamp ? Date.parse(timestamp) : Number.NaN;

  return {
    thread: nonEmpty(payload.id) ?? fallbackThread,
    parent,
    forkedAt: Number.isNaN(forkedAt) ? null : forkedAt,
  };
};

export interface CodexEvent {
  readonly ts: number;
  readonly timestamp: string;
  readonly model: string;
  readonly usage: RawUsage;
}

/** One rollout line through ccusage's visitor: a usage event, or null. Updates `state`. */
export const visitCodexLine = (text: string, state: CodexState): CodexEvent | null => {
  const line = parseLine(text);

  if (line === null) return null;
  const payload = line.payload;

  if (line.type === "turn_context") {
    state.model = modelOf(payload) ?? state.model;

    return null;
  }

  if (line.type !== "event_msg" || payload?.type !== "token_count" || !line.timestamp) return null;
  const info = payload.info;
  const total = info?.total_token_usage ? toRawUsage(info.total_token_usage) : null;
  const advanced = total === null || state.previous === null || !sameUsage(state.previous, total);
  const last = info?.last_token_usage && advanced ? toRawUsage(info.last_token_usage) : null;
  const usage = last ?? (total === null ? null : subtract(total, state.previous));

  if (total !== null) state.previous = total;

  if (usage === null || isZero(usage)) return null;
  const parsed = modelOf(payload) ?? modelOf(info);

  if (parsed !== null) state.model = parsed;
  const ts = Date.parse(line.timestamp);

  return {
    ts: Number.isNaN(ts) ? 0 : ts,
    timestamp: line.timestamp,
    model: state.model ?? "unknown",
    usage,
  };
};

/** The first two usage events' start, when they came within a second of each other. */
const detectRewrittenBurst = async (path: string, size: number): Promise<number | null> => {
  const state: CodexState = {
    seq: 0,
    previous: null,
    model: null,
    thread: "",
    parent: null,
    forkedAt: null,
    replay: { kind: "done" },
  };

  const times: Array<number> = [];

  await scanLines(path, 0, size, CODEX_SCAN, (line) => {
    const event = visitCodexLine(line, state);

    if (event !== null) times.push(event.ts);

    return times.length >= 2;
  });

  const [first, second] = times;

  if (first === undefined || second === undefined) return null;
  const pause = second - first;

  return pause >= 0 && pause <= REWRITTEN_BURST_PAUSE_MS ? first : null;
};

interface ReplayContext {
  readonly prefix: ReadonlyArray<RawUsage>;
  /** Where the rollout's head burst starts, for a fork whose parent history doesn't match. */
  readonly burst: number | null;
}

/** Against the parent's history: true when replayed, null to check again in the new state. */
const matchStep = (state: CodexState, index: number, event: CodexEvent, context: ReplayContext) => {
  const expected = context.prefix[index];

  if (expected !== undefined && sameUsage(expected, event.usage)) {
    state.replay = { kind: "matching", index: index + 1 };

    return true;
  }

  // Nothing matched: no parent log, or Codex rewrote the history. Fall back to the head burst.
  const burst = index === 0 ? context.burst : null;
  state.replay = burst === null ? { kind: "done" } : { kind: "burst", last: burst };

  return null;
};

const burstStep = (state: CodexState, last: number, event: CodexEvent): boolean => {
  const pause = event.ts - last;

  if (pause >= 0 && pause <= REWRITTEN_BURST_PAUSE_MS) {
    state.replay = { kind: "burst", last: event.ts };

    return true;
  }

  state.replay = { kind: "done" };

  return false;
};

const replayStep = (
  state: CodexState,
  event: CodexEvent,
  context: ReplayContext
): boolean | null => {
  const replay: Replay = state.replay;

  if (replay.kind === "done") return false;

  if (replay.kind === "matching") return matchStep(state, replay.index, event, context);

  return burstStep(state, replay.last, event);
};

/** Whether a fork's event is part of the parent history it replays (and so isn't counted). */
const isReplayed = (state: CodexState, event: CodexEvent, context: ReplayContext): boolean => {
  let replayed = replayStep(state, event, context);

  while (replayed === null) replayed = replayStep(state, event, context);

  return replayed;
};

/** The parent's usage stream up to the fork, which the child's head is expected to replay. */
const replayPrefix = (writer: UsageWriter, state: CodexState, path: string): Array<RawUsage> => {
  if (state.replay.kind !== "matching" || state.parent === null) return [];
  const parentFile = writer.parentFile(state.parent, path);

  if (parentFile === null) return [];
  const prefix: Array<RawUsage> = [];

  for (const row of writer.stream(parentFile)) {
    if (state.forkedAt !== null && row.ts !== null && row.ts > state.forkedAt) break;
    const usage = decodeStreamUsage(row.usage);

    if (Option.isSome(usage)) prefix.push(usage.value);
  }

  return prefix;
};

export const newCodexState = async (path: string, fallbackThread: string): Promise<CodexState> => {
  const meta = await readSessionMeta(path, fallbackThread);

  return {
    seq: 0,
    previous: null,
    model: null,
    ...meta,
    replay: meta.parent === null ? { kind: "done" } : { kind: "matching", index: 0 },
  };
};

const dedupeKey = (event: CodexEvent) => {
  const u = event.usage;

  return `${event.timestamp}\u0000${event.model}\u0000${u.input}\u0000${u.cached}\u0000${u.cacheCreation}\u0000${u.output}\u0000${u.reasoning}\u0000${u.total}`;
};

/** Reads `[offset, size)` of a rollout into the index; returns the new offset. `state` is updated. */
export const indexCodexFile = async (
  writer: UsageWriter,
  path: string,
  offset: number,
  size: number,
  state: CodexState
): Promise<number> => {
  const events: Array<CodexEvent> = [];

  const scanned = await scanLines(path, offset, size, CODEX_SCAN, (line) => {
    const event = visitCodexLine(line, state);

    if (event !== null) events.push(event);

    return false;
  });

  const atHead = state.replay.kind === "matching" && state.replay.index === 0;
  const burst = atHead && events.length > 0 ? await detectRewrittenBurst(path, size) : null;

  writer.transaction(() => {
    writer.addThread(state.thread, path);
    const context = { prefix: replayPrefix(writer, state, path), burst };

    for (const event of events) {
      writer.appendStream(path, state.seq++, event.ts, encodeStreamUsage(event.usage));

      if (isReplayed(state, event, context)) continue;
      const u = event.usage;

      writer.insertCodex(
        {
          harness: "codex",
          native: state.thread,
          ts: event.ts,
          model: event.model,
          input: u.input - u.cached - u.cacheCreation,
          cacheRead: u.cached,
          cacheWrite: u.cacheCreation,
          output: u.output,
          reasoning: u.reasoning,
          cost: null,
        },
        dedupeKey(event)
      );
    }
  });

  return scanned.offset;
};
