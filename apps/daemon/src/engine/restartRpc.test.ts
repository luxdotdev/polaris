import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Command,
  type HarnessKind,
  RequestId,
  SessionId,
  SessionPlacement,
  type Workspace,
} from "@polaris/protocol";
import { Effect, Layer, Stream } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
import { type TerminalInfo, Terminals } from "../terminal/Terminals.ts";
import { Engine } from "./Engine.ts";
import { prepareRestart, restartPreview } from "./restartRpc.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const registerWorkspace = Effect.gen(function* () {
  const repo = fakeRepo();
  yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
  const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));

  return [...model.workspaces.values()].find((w) => w.path === repo)!;
});

const startSession = (workspace: Workspace, sessionId: SessionId, harness: HarnessKind) =>
  dispatch(
    Command.cases.StartSession.make({
      sessionId,
      workspaceId: workspace.id,
      harness,
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "supervised",
      model: null,
      effort: null,
      prompt: "Fix the flaky test",
      attachments: [],
    })
  );

const terminal = (exit: TerminalInfo["exit"]): TerminalInfo =>
  // SAFETY: the preview reads only `exit`; the rest of a TerminalInfo is irrelevant here.
  ({ exit }) as TerminalInfo;

/** Terminals that only list: the preview calls nothing else. */
const fakeTerminals = (list: ReadonlyArray<TerminalInfo>) =>
  Layer.succeed(Terminals)(
    Terminals.of({
      open: () => Effect.die("unused"),
      attach: () => Stream.die("unused"),
      input: () => Effect.die("unused"),
      resize: () => Effect.die("unused"),
      close: () => Effect.die("unused"),
      list: Effect.succeed(list),
    })
  );

describe("Restart daemon's RPCs", () => {
  test("the preview counts Working sessions, running terminals and pending approvals; prepare ends Claude's Turn", async () => {
    const claude = makeFakeDriver("claude");
    const codex = makeFakeDriver("codex", { liveCoAttach: true });

    const layer = Layer.merge(
      engineLayer({
        filename: join(tempDir(), "state.sqlite"),
        fakes: makeFakes(),
        drivers: [claude, codex],
      }),
      fakeTerminals([terminal(null), terminal({ code: 0 }), terminal(null)])
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;
        const busy = SessionId.make("s-busy");
        const shared = SessionId.make("s-codex");
        yield* startSession(workspace, busy, "claude");
        yield* startSession(workspace, shared, "codex");
        yield* waitFor(
          (m) =>
            m.sessions.get(busy)?.session.state === "working" &&
            m.sessions.get(shared)?.session.state === "working"
        );
        const harness = claude.latest(busy)!;
        harness.emit(
          HarnessEvent.ApprovalRequested({
            turnId: harness.turns[0]!.turnId,
            requestId: RequestId.make("req-restart"),
            kind: "command",
            title: "Run",
            detail: null,
            options: [],
          })
        );
        yield* waitFor((m) => m.sessions.get(busy)?.pending.size === 1);
        const preview = yield* restartPreview;
        const prepared = yield* prepareRestart;
        const model = yield* EventStore.pipe(Effect.flatMap((store) => store.model));

        return { preview, prepared, model, closed: harness.closed, busy, shared };
      }).pipe(Effect.provide(layer))
    );

    expect(result.preview.workingSessions.map((s) => s.sessionId).toSorted()).toEqual([
      result.busy,
      result.shared,
    ]);
    expect(result.preview.terminals).toBe(2);
    expect(result.preview.pendingApprovals).toBe(1);
    // Claude's Turn ends cleanly before the stop; Codex's app-server outlives the Daemon.
    expect(result.prepared.interruptedTurns).toBe(1);
    expect(result.closed).toBe(true);
    expect(result.model.sessions.get(result.busy)!.turns[0]!.status).toBe("interrupted");
    expect(result.model.sessions.get(result.shared)!.session.state).toBe("working");
  });
});
