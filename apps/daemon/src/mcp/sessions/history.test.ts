import { expect, test } from "bun:test";
import { AgentSession, DomainEvent, SessionId, TurnItem, WorkspaceId } from "@polaris/protocol";
import { Effect } from "effect";
import { finish, send } from "../../constellation/delivery/testing.ts";
import { AT } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { HistoryOutcome, sessionTools } from "./index.ts";

const SELF = SessionId.make("self-4a1b9c");

const NEIGHBOUR = SessionId.make("neighbour-77d2e0");

const ELSEWHERE = SessionId.make("elsewhere-0c3f51");

const HOME = WorkspaceId.make("ws");

const AWAY = WorkspaceId.make("other-workspace");

const run = <A, E>(effect: Effect.Effect<A, E, EventStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(EventStore.layerSqlite(":memory:"))));

const create = Effect.fnUntraced(function* (
  sessionId: SessionId,
  title: string,
  workspaceId: WorkspaceId
) {
  const store = yield* EventStore;

  const created = new AgentSession({
    id: sessionId,
    workspaceId,
    harness: "codex",
    title,
    cwd: "/tmp",
    worktreeId: null,
    state: "idle",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
  });

  yield* store.commit({
    commandId: null,
    decide: () => Effect.succeed([DomainEvent.cases.SessionCreated.make({ session: created })]),
  });
});

const item = Effect.fnUntraced(function* (sessionId: SessionId, value: TurnItem) {
  const store = yield* EventStore;
  const turn = (yield* store.model).sessions.get(sessionId)!.turns.at(-1)!;
  yield* store.commit({
    commandId: null,
    decide: () =>
      Effect.succeed([
        DomainEvent.cases.TurnItemCompleted.make({
          sessionId,
          turnId: turn.id,
          item: value,
          subagentId: null,
        }),
      ]),
  });
});

const turn = Effect.fnUntraced(function* (
  sessionId: SessionId,
  prompt: string,
  ...items: ReadonlyArray<TurnItem>
) {
  yield* send(sessionId, prompt);

  for (const value of items) yield* item(sessionId, value);
  yield* finish(sessionId);
});

const reply = (id: string, text: string) =>
  TurnItem.cases.AssistantMessage.make({ id, text, startedAt: null });

/** Three sessions: SELF and NEIGHBOUR share a Workspace, ELSEWHERE is in another. */
const world = Effect.gen(function* () {
  yield* create(SELF, "Order lunch", HOME);
  yield* create(NEIGHBOUR, "Groceries", HOME);
  yield* create(ELSEWHERE, "Taxes", AWAY);

  yield* turn(
    SELF,
    "Order lunch",
    TurnItem.cases.CommandExecution.make({
      id: "c1",
      startedAt: null,
      command: "open-app delivery",
      cwd: "/tmp",
      output: "Signed in to Uber  Eats as dax; cart has 2 items",
      exitCode: 0,
      status: "completed",
    })
  );
  yield* turn(SELF, "Pick a drink", reply("r2", "Picked sparkling water."));
  yield* turn(
    SELF,
    "Where were we?",
    TurnItem.cases.ToolCall.make({
      id: "t3",
      startedAt: null,
      name: "mcp__polaris__search_history",
      input: { query: "uber eats" },
      output: "Turn 1 · command: Signed in to Uber Eats",
      status: "completed",
    })
  );
  yield* turn(NEIGHBOUR, "Groceries", reply("r4", "Ordered through Uber Eats too."));
  yield* turn(ELSEWHERE, "Taxes", reply("r5", "Uber eats receipts are deductible?"));

  return sessionTools(yield* EventStore);
});

const textOf = (outcome: HistoryOutcome) =>
  HistoryOutcome.$match(outcome, {
    Text: ({ text }) => text,
    NoCaller: () => "NoCaller",
    NotFound: ({ reference }) => `NotFound ${reference}`,
    Ambiguous: ({ reference }) => `Ambiguous ${reference}`,
  });

test("search_history finds every word in an older Turn's command output and names that Turn", async () => {
  const text = await run(
    Effect.gen(function* () {
      const tools = yield* world;

      return textOf(
        yield* tools.searchHistory(SELF, {
          query: "UBER eats",
          scope: "session",
          session: null,
          limit: 20,
        })
      );
    })
  );

  expect(text).toContain("1 matches");
  expect(text).toContain("Turn 1 ·");
  expect(text).toContain("command: $ open-app delivery Signed in to Uber Eats as dax");
  // Its own earlier search_history call echoes the match; that isn't a second hit.
  expect(text).not.toContain("Turn 3");
  expect(text).not.toContain("Groceries");
});

test("a search needs every word, not any of them", async () => {
  const text = await run(
    Effect.gen(function* () {
      const tools = yield* world;

      return textOf(
        yield* tools.searchHistory(SELF, {
          query: "uber pizza",
          scope: "host",
          session: null,
          limit: 20,
        })
      );
    })
  );

  expect(text).toStartWith("No matches");
});

test.each([
  ["workspace", [SELF, NEIGHBOUR], [ELSEWHERE]],
  ["host", [SELF, NEIGHBOUR, ELSEWHERE], []],
] as const)("scope %s searches the sessions it covers", async (scope, found, absent) => {
  const text = await run(
    Effect.gen(function* () {
      const tools = yield* world;

      return textOf(
        yield* tools.searchHistory(SELF, { query: "uber eats", scope, session: null, limit: 20 })
      );
    })
  );

  for (const sessionId of found) expect(text).toContain(sessionId);

  for (const sessionId of absent) expect(text).not.toContain(sessionId);
});

test("read_history opens another session by id prefix or title, and its own by default", async () => {
  const [byPrefix, byTitle, own, missing] = await run(
    Effect.gen(function* () {
      const tools = yield* world;

      const read = (session: string | null) =>
        tools.readHistory(SELF, { session, turns: 2, since: null }).pipe(Effect.map(textOf));

      return [
        yield* read("neighbour-77"),
        yield* read("taxes"),
        yield* read(null),
        yield* read("nobody"),
      ];
    })
  );

  expect(byPrefix).toContain("Assistant: Ordered through Uber Eats too.");
  expect(byTitle).toContain("Assistant: Uber eats receipts are deductible?");
  expect(own).toContain(`Session ${SELF}`);
  expect(own).toContain("Prompt: Where were we?");
  expect(missing).toBe("NotFound nobody");
});

test("sessions lists the Workspace's sessions by default and the Host's on request", async () => {
  const [workspace, host, filtered] = await run(
    Effect.gen(function* () {
      const tools = yield* world;

      const list = (scope: "workspace" | "host", query: string | null) =>
        tools.listSessions(SELF, { scope, query, limit: 20 }).pipe(Effect.map(textOf));

      return [
        yield* list("workspace", null),
        yield* list("host", null),
        yield* list("host", "tax"),
      ];
    })
  );

  expect(workspace).toStartWith("2 sessions:");
  expect(workspace).toContain(`${SELF} · "Order lunch"`);
  expect(workspace).toContain("(this session)");
  expect(workspace).not.toContain(ELSEWHERE);
  expect(host).toStartWith("3 sessions:");
  expect(filtered).toStartWith("1 sessions:");
  expect(filtered).toContain(ELSEWHERE);
});
