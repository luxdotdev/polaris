/**
 * Session history for every agent: list the Host's sessions, search their Turns for words,
 * and read one's Turns (`sessions`, `search_history`, `read_history`).
 */
import type { AgentSession, SessionId, Turn, TurnItem } from "@polaris/protocol";
import { Data, Effect, Match } from "effect";
import type { EventStore } from "../../store/EventStore.ts";
import type { ReadModel } from "../../store/model.ts";
import type { ServiceError } from "../../services.ts";
import { readTranscript } from "./read.ts";

export type HistoryScope = "session" | "workspace" | "host";

export type HistoryOutcome = Data.TaggedEnum<{
  Text: { readonly text: string };
  /** The calling session isn't on this Daemon. */
  NoCaller: Record<never, never>;
  NotFound: { readonly reference: string };
  Ambiguous: { readonly reference: string; readonly candidates: ReadonlyArray<AgentSession> };
}>;

export const HistoryOutcome = Data.taggedEnum<HistoryOutcome>();

/** A session reference that didn't resolve; the tool answers with its outcome. */
class Unresolved extends Data.TaggedError("Unresolved")<{ readonly outcome: HistoryOutcome }> {}

export interface ListOptions {
  readonly scope: Exclude<HistoryScope, "session">;
  /** Words every listed title contains; null lists all. */
  readonly query: string | null;
  readonly limit: number;
}

export interface SearchOptions {
  readonly query: string;
  readonly scope: HistoryScope;
  /** With scope `session`: an id, id prefix or exact title; null for the caller's own. */
  readonly session: string | null;
  readonly limit: number;
}

export interface ReadOptions {
  readonly session: string | null;
  readonly turns: number;
  readonly since: number | null;
}

/** A search reads at most this many Turns, newest first, then says it stopped. */
export const SEARCH_TURN_BUDGET = 2_000;

const PAGE_TURNS = 100;

const SNIPPET_BEFORE = 120;

const SNIPPET_AFTER = 160;

const PREFIX_MINIMUM = 6;

/** Earlier history calls echo their own matches; searching them again is only noise. */
const HISTORY_TOOL = /(?:^|[_.])(?:search_history|read_history)$/;

interface Blob {
  readonly source: string;
  readonly text: string;
}

const itemBlob = Match.type<TurnItem>().pipe(
  Match.tagsExhaustive({
    AssistantMessage: (item): Blob | null => ({ source: "reply", text: item.text }),
    UserMessage: (item) => ({ source: "steer", text: item.text }),
    Reasoning: () => null,
    CommandExecution: (item) => ({ source: "command", text: `$ ${item.command}\n${item.output}` }),
    FileChange: (item) => ({
      source: "files",
      text: item.changes.map((change) => `${change.kind} ${change.path}`).join("\n"),
    }),
    ToolCall: (item) =>
      HISTORY_TOOL.test(item.name)
        ? null
        : {
            source: `tool ${item.name}`,
            text: `${item.name} ${JSON.stringify(item.input) ?? ""}\n${item.output === null ? "" : JSON.stringify(item.output)}`,
          },
    Plan: (item) => ({ source: "plan", text: item.steps.map((step) => step.text).join("\n") }),
    Error: (item) => ({ source: "error", text: item.message }),
  })
);

const termsOf = (query: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");

/** Where the first term starts when the text holds every term; -1 otherwise. */
const matchAt = (text: string, terms: ReadonlyArray<string>) => {
  const lower = text.toLowerCase();

  return terms.every((term) => lower.includes(term)) ? lower.indexOf(terms[0] ?? "") : -1;
};

const snippet = (text: string, at: number) => {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + SNIPPET_AFTER);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();

  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
};

export interface HistoryHit {
  readonly session: AgentSession;
  /** One-based, as transcripts number Turns. */
  readonly turn: number;
  readonly at: string;
  readonly source: string;
  readonly snippet: string;
}

const turnHits = (
  session: AgentSession,
  turn: Turn,
  items: ReadonlyArray<TurnItem>,
  terms: ReadonlyArray<string>
) => {
  const blobs = [
    { source: "prompt", text: turn.prompt },
    ...items.flatMap((item) => itemBlob(item) ?? []),
  ];

  return blobs.flatMap((blob): ReadonlyArray<HistoryHit> => {
    const at = matchAt(blob.text, terms);

    if (at < 0) return [];

    return [
      {
        session,
        turn: turn.index + 1,
        at: turn.startedAt,
        source: blob.source,
        snippet: snippet(blob.text, at),
      },
    ];
  });
};

const byRecent = (a: AgentSession, b: AgentSession) => b.updatedAt.localeCompare(a.updatedAt);

/** The sessions a scope covers, most recently updated first. */
const inScope = (model: ReadModel, caller: AgentSession, scope: Exclude<HistoryScope, "session">) =>
  [...model.sessions.values()]
    .flatMap(({ session }) =>
      scope === "host" || session.workspaceId === caller.workspaceId ? [session] : []
    )
    .sort(byRecent);

/** An exact id, then a unique id prefix, then a unique exact title (case-insensitive). */
const resolveSession = (model: ReadModel, caller: AgentSession, reference: string | null) => {
  if (reference === null) return Effect.succeed(caller);

  const sessions = [...model.sessions.values()].map((record) => record.session);
  const exact = sessions.find((session) => session.id === reference);

  if (exact !== undefined) return Effect.succeed(exact);

  const lower = reference.toLowerCase();

  const prefixed =
    reference.length >= PREFIX_MINIMUM
      ? sessions.filter((session) => session.id.startsWith(reference))
      : [];

  const matches =
    prefixed.length > 0
      ? prefixed
      : sessions.filter((session) => session.title.toLowerCase() === lower);

  const [only] = matches;

  if (matches.length === 1 && only !== undefined) return Effect.succeed(only);

  return Effect.fail(
    new Unresolved({
      outcome:
        matches.length === 0
          ? HistoryOutcome.NotFound({ reference })
          : HistoryOutcome.Ambiguous({ reference, candidates: matches.sort(byRecent) }),
    })
  );
};

export const sessionLine = (session: AgentSession, caller: SessionId) =>
  [
    `- ${session.id}`,
    `"${session.title || "Untitled"}"`,
    session.harness,
    session.state,
    `${session.turnCount} Turns`,
    `updated ${session.updatedAt}`,
    ...(session.id === caller ? ["(this session)"] : []),
  ].join(" · ");

interface Scan {
  readonly hits: Array<HistoryHit>;
  turns: number;
  sessions: number;
}

/** Pages one session's Turns newest first, until the hits or the Turn budget run out. */
const scanSession = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  session: AgentSession,
  terms: ReadonlyArray<string>,
  limit: number,
  scan: Scan
) {
  scan.sessions += 1;
  let before: number | null = null;

  while (scan.hits.length < limit && scan.turns < SEARCH_TURN_BUDGET) {
    const page: ReadonlyArray<Turn> = yield* store.readTurns({
      sessionId: session.id,
      beforeIndex: before,
      limit: Math.min(PAGE_TURNS, SEARCH_TURN_BUDGET - scan.turns),
    });

    if (page.length === 0) return;

    const sequence = (yield* store.model).sequence;
    const items = yield* store.readTurnItems({ turnIds: page.map((t) => t.id), upTo: sequence });

    for (const turn of [...page].reverse()) {
      scan.hits.push(...turnHits(session, turn, items.get(turn.id) ?? [], terms));
    }

    scan.turns += page.length;
    before = page[0]?.index ?? 0;
    yield* Effect.yieldNow;
  }
});

const hitLine = (hit: HistoryHit, scope: HistoryScope) => {
  const where = scope === "session" ? "" : `${hit.session.id} "${hit.session.title}" · `;

  return `- ${where}Turn ${hit.turn} · ${hit.at} · ${hit.source}: ${hit.snippet}`;
};

const searchText = (options: SearchOptions, scan: Scan) => {
  const hits = scan.hits.slice(0, options.limit);
  const stopped = scan.turns >= SEARCH_TURN_BUDGET;

  const summary = `${hits.length === 0 ? "No matches" : `${hits.length} matches`} for "${options.query}" in ${scan.turns} Turns of ${scan.sessions} sessions, newest first.`;

  return [
    summary,
    ...hits.map((hit) => hitLine(hit, options.scope)),
    ...(stopped
      ? [
          `Stopped after ${SEARCH_TURN_BUDGET} Turns; older ones weren't searched. Narrow with session or more words.`,
        ]
      : []),
  ].join("\n");
};

const search = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  caller: AgentSession,
  options: SearchOptions
) {
  const model = yield* store.model;

  const targets =
    options.scope === "session"
      ? [yield* resolveSession(model, caller, options.session)]
      : inScope(model, caller, options.scope);

  const terms = termsOf(options.query);
  const scan: Scan = { hits: [], turns: 0, sessions: 0 };

  for (const session of targets) {
    if (scan.hits.length >= options.limit || scan.turns >= SEARCH_TURN_BUDGET) break;
    yield* scanSession(store, session, terms, options.limit, scan);
  }

  return HistoryOutcome.Text({ text: searchText(options, scan) });
});

const list = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  caller: AgentSession,
  options: ListOptions
) {
  const model = yield* store.model;
  const terms = termsOf(options.query ?? "");

  const sessions = inScope(model, caller, options.scope).filter(
    (session) => matchAt(session.title, terms) >= 0
  );

  const shown = sessions.slice(0, options.limit);

  const lines = shown.map((session) => {
    const line = sessionLine(session, caller.id);
    const workspace = model.workspaces.get(session.workspaceId)?.name;

    return options.scope === "host" && workspace !== undefined ? `${line} · ${workspace}` : line;
  });

  return HistoryOutcome.Text({
    text: [
      `${sessions.length} sessions${sessions.length > shown.length ? `, the ${shown.length} most recent shown` : ""}:`,
      ...lines,
    ].join("\n"),
  });
});

const read = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  caller: AgentSession,
  options: ReadOptions
) {
  const session = yield* resolveSession(yield* store.model, caller, options.session);
  const transcript = yield* readTranscript(store, session.id, options);

  return transcript === null
    ? HistoryOutcome.NotFound({ reference: session.id })
    : HistoryOutcome.Text({ text: `Session ${session.id}\n${transcript}` });
});

const asCaller =
  <O>(
    store: EventStore["Service"],
    run: (
      store: EventStore["Service"],
      caller: AgentSession,
      options: O
    ) => Effect.Effect<HistoryOutcome, ServiceError | Unresolved>
  ) =>
  (callerId: SessionId, options: O): Effect.Effect<HistoryOutcome, ServiceError> =>
    Effect.gen(function* () {
      const caller = (yield* store.model).sessions.get(callerId)?.session;

      if (caller === undefined) return HistoryOutcome.NoCaller();

      return yield* run(store, caller, options);
    }).pipe(Effect.catchTag("Unresolved", (error) => Effect.succeed(error.outcome)));

export const history = (store: EventStore["Service"]) => ({
  listSessions: asCaller(store, list),
  searchHistory: asCaller(store, search),
  readHistory: asCaller(store, read),
});
