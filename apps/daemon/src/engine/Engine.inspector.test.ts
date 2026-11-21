/** An Inspector's Harness (ADR 0119): read-only, the verdict server alone, and nothing asked. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  AgentSession,
  Command,
  ConstellationId,
  type HarnessKind,
  RequestId,
  SessionId,
} from "@polaris/protocol";
import { Effect, Layer, Predicate } from "effect";
import { ConstellationHarness } from "../constellation/composition/attachments.ts";
import type { ConstellationAttachment } from "../harness/constellation/attachment.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
import { Engine } from "./Engine.ts";
import { decideSession } from "./session.ts";
import {
  cid,
  engineLayer,
  type FakeDriver,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
} from "./testing.ts";

const INSPECTOR = SessionId.make("inspection-1:inspector");

const verdictServer: ConstellationAttachment = {
  sessionId: INSPECTOR,
  instructions: "You are a Polaris inspector.",
  url: "http://127.0.0.1:1/mcp/token",
  tools: [],
  role: "Inspector",
};

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

/** The Constellation's own session, as the Inspection runner creates it, and its first Turn. */
const inspect = Effect.fnUntraced(function* (harness: HarnessKind) {
  const store = yield* EventStore;
  const repo = fakeRepo();
  yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
  const registered = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));
  const workspace = [...registered.workspaces.values()].find((w) => w.path === repo)!;
  const at = new Date().toISOString();

  const session = new AgentSession({
    id: INSPECTOR,
    workspaceId: workspace.id,
    harness,
    model: null,
    effort: null,
    serviceTier: null,
    cwd: repo,
    worktreeId: null,
    title: "A · inspection",
    state: "dormant",
    permissionMode: "plan",
    celestial: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    worker: { constellationId: ConstellationId.make("c1"), role: "inspector" },
    createdAt: at,
    updatedAt: at,
  });

  yield* store.commit({
    commandId: null,
    decide: () =>
      Effect.succeed(decideSession(undefined, { type: "session.fork", session }).events),
  });
  yield* (yield* ConstellationHarness).activate({
    install: () => Effect.void,
    open: () => Effect.succeed({ constellations: [verdictServer], environment: {} }),
  });
  yield* dispatch(
    Command.cases.SendTurn.make({ sessionId: INSPECTOR, prompt: "Inspect it", attachments: [] })
  );
});

const world = (driver: FakeDriver) =>
  engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
  }).pipe(Layer.provideMerge(ConstellationHarness.layer));

test("an Inspector's Harness opens read-only with its verdict server, and its approval request is denied unasked", async () => {
  const codex = makeFakeDriver("codex");

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* inspect("codex");
      yield* waitUntil(() => codex.latest(INSPECTOR)?.turns.length === 1);
      const harness = codex.latest(INSPECTOR)!;

      expect(harness.options.readOnly).toBe(true);
      expect(harness.options.constellations).toEqual([verdictServer]);

      const requestId = RequestId.make("req-edit");
      harness.emit(
        HarnessEvent.ApprovalRequested({
          turnId: harness.turns[0]!.turnId,
          requestId,
          kind: "command",
          title: "Run rm -rf .",
          detail: null,
          options: [],
        })
      );
      yield* waitUntil(() => harness.responses.length === 1);

      expect(harness.responses[0]!.requestId).toBe(requestId);
      expect(Predicate.isTagged(harness.responses[0]!.decision, "Deny")).toBe(true);
      // Nobody watches this session: it never waits in Needs You.
      expect((yield* (yield* EventStore).model).sessions.get(INSPECTOR)!.session.state).toBe(
        "working"
      );
    }).pipe(Effect.provide(world(codex)))
  );
});

test("a Harness that can't hold an Inspector to its checkout never opens for one", async () => {
  const gemini = makeFakeDriver("gemini", { constellations: true });

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* inspect("gemini");
      const model = yield* waitFor((m) => m.sessions.get(INSPECTOR)?.session.state === "failed");

      expect(gemini.sessions).toEqual([]);
      expect(model.sessions.get(INSPECTOR)!.session.lastError).toBe(
        "Gemini CLI can't keep an inspector to its checkout. Choose Claude Code or Codex as the inspector in Settings → Constellations."
      );
    }).pipe(Effect.provide(world(gemini)))
  );
});
