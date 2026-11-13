/**
 * The `origins` tool's lookups (ADR 0111): which Agent Sessions and Turns on this Host wrote a
 * file's lines or a commit, as compact text with each Turn's prompt and final reply.
 */
import {
  type AgentSession,
  MAX_ORIGIN_LINES,
  type OriginLine,
  type OriginSession,
  type SessionId,
  type TurnId,
  type TurnItem,
} from "@polaris/protocol";
import { Data, Effect, Predicate } from "effect";
import type { Blamed, Origins } from "../../origins/index.ts";
import type { ServiceError } from "../../services.ts";
import type { EventStore } from "../../store/EventStore.ts";

export type OriginsQuery =
  | {
      /** Relative to the caller's checkout (its Worktree, or its Workspace). */
      readonly path: string;
      /** Inclusive; null blames from the top of the file. */
      readonly lines: { readonly start: number; readonly end: number } | null;
    }
  | { readonly commit: string };

export type OriginsOutcome = Data.TaggedEnum<{
  Text: { readonly text: string };
  /** The calling session isn't on this Daemon. */
  NoCaller: Record<never, never>;
  /** A file, Worktree, Workspace or commit that isn't there. */
  Missing: { readonly what: string; readonly id: string };
  GitFailed: { readonly message: string };
}>;

export const OriginsOutcome = Data.taggedEnum<OriginsOutcome>();

export interface OriginSessionTools {
  readonly lookup: (
    caller: SessionId,
    query: OriginsQuery
  ) => Effect.Effect<OriginsOutcome, ServiceError>;
}

/** The most sessions, and Turns of each, one answer describes. */
const SESSIONS_SHOWN = 10;

const TURNS_SHOWN = 5;

const EXCERPT = 200;

const NONE_HERE =
  "No Agent Session on this Host wrote these lines. A person may have written them, or a session on another Host, or one whose checkpoints are gone: origins sees only this Host's sessions.";

const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);

  return chars.length > EXCERPT ? `${chars.slice(0, EXCERPT).join("")}…` : flat;
};

const when = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : "time unknown");

/** `1-3, 7, 9-10` from ascending line numbers. */
export const lineRanges = (lines: ReadonlyArray<number>) => {
  const ranges: Array<[number, number]> = [];

  for (const line of lines) {
    const last = ranges.at(-1);

    if (last !== undefined && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }

  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
};

const commitLines = (blamed: Blamed) => {
  const groups = new Map<string, { label: string; lines: Array<number> }>();

  for (const { line, commit } of blamed.lines) {
    const key = commit?.sha ?? "";

    const label =
      commit === null
        ? "not committed"
        : `${commit.sha.slice(0, 9)} "${commit.subject}" · ${commit.authorName} · ${when(commit.time)}`;

    const group = groups.get(key) ?? { label, lines: [] };

    group.lines.push(line);
    groups.set(key, group);
  }

  return [...groups.values()].map(({ label, lines }) => `- ${label}: lines ${lineRanges(lines)}`);
};

const finalReply = (items: ReadonlyArray<TurnItem>) =>
  items
    .flatMap((item) => (Predicate.isTagged(item, "AssistantMessage") ? [item.text] : []))
    .at(-1) ?? null;

const sessionHead = (origin: OriginSession, session: AgentSession | undefined) =>
  [
    `- "${origin.title || "Untitled"}"`,
    origin.sessionId,
    origin.harness,
    origin.archived ? "archived" : origin.sessionState,
    ...(session?.worktreeId == null ? [] : ["in a Worktree"]),
  ].join(" · ");

/** The sessions with their newest Turns: number, id, time, prompt and final reply. */
const describeSessions = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  sessions: ReadonlyArray<OriginSession>,
  linesOf: (sessionId: SessionId) => string | null
) {
  const model = yield* store.model;
  const shown = sessions.slice(0, SESSIONS_SHOWN);
  const turnsOf = (origin: OriginSession) => origin.turns.slice(-TURNS_SHOWN);

  const items = yield* store.readTurnItems({
    turnIds: shown.flatMap((origin) => turnsOf(origin).map((turn) => turn.turnId)),
    upTo: model.sequence,
  });

  const blocks: Array<string> = [];

  for (const origin of shown) {
    const lines = linesOf(origin.sessionId);
    const earlier = origin.turns.length - turnsOf(origin).length;

    blocks.push(
      `${sessionHead(origin, model.sessions.get(origin.sessionId)?.session)}${lines === null ? "" : ` · lines ${lines}`}`
    );

    if (earlier > 0) blocks.push(`  (${earlier} earlier Turns of it also wrote them)`);

    for (const { turnId, time, prompt } of turnsOf(origin)) {
      const turn = yield* store.readTurn({ sessionId: origin.sessionId, turnId });
      const reply = finalReply(items.get(turnId) ?? []);
      const number = turn === null ? "Turn" : `Turn ${turn.index + 1}`;

      blocks.push(`  - ${number} · ${turnId} · ${when(time)}`, `    prompt: "${excerpt(prompt)}"`);

      if (reply !== null) blocks.push(`    reply: "${excerpt(reply)}"`);
    }
  }

  if (sessions.length > shown.length)
    blocks.push(`… and ${sessions.length - shown.length} more sessions.`);

  return blocks;
});

const nextHint = (sessions: ReadonlyArray<OriginSession>) => {
  const turnId: TurnId | undefined = sessions[0]?.turns.at(-1)?.turnId;

  return turnId === undefined
    ? []
    : [`Next: read_history with turn (e.g. turn "${turnId}") opens the full Turn.`];
};

const sessionLines = (lines: ReadonlyArray<OriginLine>) => (sessionId: SessionId) => {
  const numbers = lines.flatMap((line) =>
    line.origins.some((origin) => origin.sessionId === sessionId) ? [line.line] : []
  );

  return numbers.length === 0 ? null : lineRanges(numbers);
};

const forLines = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  origins: Origins["Service"],
  caller: AgentSession,
  path: string,
  range: { readonly start: number; readonly end: number } | null
) {
  const start = range?.start ?? 1;
  const end = Math.min(range?.end ?? Number.MAX_SAFE_INTEGER, start + MAX_ORIGIN_LINES - 1);

  const blamed = yield* origins.blame({
    workspaceId: caller.workspaceId,
    worktreeId: caller.worktreeId,
    path,
    startLine: start,
    endLine: end,
  });

  if (blamed.lines.length === 0)
    return OriginsOutcome.Text({ text: `${path} has no lines ${start}-${end}.` });

  const matched = yield* origins.match(
    blamed.repoKey,
    blamed.lines.map((line) => ({
      line: line.line,
      path: line.path,
      hash: line.hash,
      commitSha: line.commit?.sha ?? null,
      commitTime: line.commit?.time ?? null,
    }))
  );

  const first = blamed.lines[0]!.line;
  const last = blamed.lines.at(-1)!.line;

  const body =
    matched.sessions.length === 0
      ? [NONE_HERE]
      : [
          `Origins: the Agent Sessions on this Host that wrote these lines, with their Turns:`,
          ...(yield* describeSessions(store, matched.sessions, sessionLines(matched.lines))),
          ...nextHint(matched.sessions),
        ];

  return OriginsOutcome.Text({
    text: [`${path} lines ${first}-${last}`, "Commits:", ...commitLines(blamed), ...body].join(
      "\n"
    ),
  });
});

const forCommit = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  origins: Origins["Service"],
  caller: AgentSession,
  sha: string
) {
  const sessions = yield* origins.forCommit(caller.workspaceId, sha);

  const body =
    sessions.length === 0
      ? [NONE_HERE.replace("these lines", "the lines this commit added")]
      : [
          `Origins: the Agent Sessions on this Host that wrote lines this commit added, with their Turns:`,
          ...(yield* describeSessions(store, sessions, () => null)),
          ...nextHint(sessions),
        ];

  return OriginsOutcome.Text({ text: [`Commit ${sha}`, ...body].join("\n") });
});

export const sessionOriginTools = (
  store: EventStore["Service"],
  origins: Origins["Service"]
): OriginSessionTools => ({
  lookup: (callerId, query) =>
    Effect.gen(function* () {
      const caller = (yield* store.model).sessions.get(callerId)?.session;

      if (caller === undefined) return OriginsOutcome.NoCaller();

      return yield* "commit" in query
        ? forCommit(store, origins, caller, query.commit)
        : forLines(store, origins, caller, query.path, query.lines);
    }).pipe(
      Effect.catchTags({
        NotFound: (error) =>
          Effect.succeed(OriginsOutcome.Missing({ what: error.what, id: error.id })),
        GitError: (error) => Effect.succeed(OriginsOutcome.GitFailed({ message: error.message })),
      })
    ),
});
