/** Every binding's history tools: `sessions`, `search_history` and `read_history`. */
import type { SessionId } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { HistoryOutcome, sessionLine } from "../sessions/history.ts";
import type { SessionTools } from "../sessions/index.ts";
import { rejection, type BoundTool } from "./shared.ts";
import { sessionTool, text } from "./session.ts";

const Scope = Schema.Literals(["session", "workspace", "host"]);

const Limit = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));

const readFailed = rejection("E-READ", "The history couldn't be read", "Try again shortly.");

const answer = (caller: SessionId, next: string) => (outcome: HistoryOutcome) =>
  HistoryOutcome.$match(outcome, {
    Text: ({ text: body }) => Effect.succeed(text([body, `Next: ${next}`])),
    NoCaller: () =>
      Effect.fail(
        rejection("E-SESSION", "This session isn't on this Host", "Continue without history.")
      ),
    NotFound: ({ reference }) =>
      Effect.fail(
        rejection(
          "E-NOT-FOUND",
          `No session matches "${reference}"`,
          "Call sessions to find its id, or leave session out to use your own."
        )
      ),
    Ambiguous: ({ reference, candidates }) =>
      Effect.fail(
        rejection(
          "E-AMBIGUOUS",
          `"${reference}" matches ${candidates.length} sessions: ${candidates
            .slice(0, 5)
            .map((session) => sessionLine(session, caller))
            .join("; ")}`,
          "Name the session by its full id."
        )
      ),
  });

export const sessionsTool = (caller: SessionId, sessions: SessionTools): BoundTool =>
  sessionTool(
    "sessions",
    "List Agent Sessions on this Host, most recently updated first: id, title, Harness, state, Turn count. scope is workspace (default, your Workspace) or host; query keeps titles containing every word. Use an id with search_history or read_history.",
    Schema.Struct({
      scope: Schema.optionalKey(Schema.Literals(["workspace", "host"])),
      query: Schema.optionalKey(Schema.String),
      limit: Schema.optionalKey(Limit(50)),
    }),
    (input) =>
      sessions
        .listSessions(caller, {
          scope: input.scope ?? "workspace",
          query: input.query ?? null,
          limit: input.limit ?? 20,
        })
        .pipe(
          Effect.mapError(() => readFailed),
          Effect.flatMap(
            answer(caller, "Search one with search_history, or read it with read_history.")
          )
        )
  );

export const searchHistoryTool = (caller: SessionId, sessions: SessionTools): BoundTool =>
  sessionTool(
    "search_history",
    "Search session history for words and get short snippets with their Turn numbers, instead of reading whole transcripts: earlier work in your own session (including what compaction dropped) or past sessions. Matches prompts, replies, steers, commands with output, tool calls, file changes and plans that contain every word of query (case-insensitive). scope is session (default: yours, or the one named by session), workspace or host. Newest first.",
    Schema.Struct({
      query: Schema.NonEmptyString,
      scope: Schema.optionalKey(Scope),
      session: Schema.optionalKey(Schema.NonEmptyString),
      limit: Schema.optionalKey(Limit(50)),
    }),
    (input) =>
      sessions
        .searchHistory(caller, {
          query: input.query,
          scope: input.scope ?? "session",
          session: input.session ?? null,
          limit: input.limit ?? 20,
        })
        .pipe(
          Effect.mapError(() => readFailed),
          Effect.flatMap(answer(caller, "Read a match in full with read_history and since."))
        )
  );

export const readHistoryTool = (caller: SessionId, sessions: SessionTools): BoundTool =>
  sessionTool(
    "read_history",
    "Read a session's Turns as compact text: prompts, replies, commands with output tails, file changes. session is an id, id prefix or exact title (default: your own). turns is how many (default 2, at most 10); since starts from that Turn number, so search_history's Turn numbers open here.",
    Schema.Struct({
      session: Schema.optionalKey(Schema.NonEmptyString),
      turns: Schema.optionalKey(Limit(10)),
      since: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
    }),
    (input) =>
      sessions
        .readHistory(caller, {
          session: input.session ?? null,
          turns: input.turns ?? 2,
          since: input.since ?? null,
        })
        .pipe(
          Effect.mapError(() => readFailed),
          Effect.flatMap(answer(caller, "Continue with what you found."))
        )
  );

export const historyTools = (caller: SessionId, sessions: SessionTools) => [
  sessionsTool(caller, sessions),
  searchHistoryTool(caller, sessions),
  readHistoryTool(caller, sessions),
];
