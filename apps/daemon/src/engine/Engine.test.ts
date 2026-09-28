import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type {
  Command,
  HarnessKind,
  HostStreamItem,
  RequestId,
  SessionId,
  SessionStreamItem,
  TurnId,
  Workspace,
} from "@polaris/protocol";
import { Duration, Effect, Exit, Fiber, type Layer, Stream } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { CONTINUE_PROMPT } from "./decider.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  completesTurns,
  engineLayer,
  type FakeDriver,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
} from "./testing.ts";

type Env = Engine | EventStore;

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)) as Effect.Effect<A, E>);

const sid = (s: string) => s as SessionId;

const dispatch = (command: Command, deviceLabel = "MacBook") =>
  Effect.flatMap(Engine, (engine) => engine.dispatch({ commandId: cid(), command, deviceLabel }));

const registerWorkspace = Effect.gen(function* () {
  const repo = fakeRepo();
  yield* dispatch({ _tag: "RegisterWorkspace", path: repo, name: null });
  const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));

  return [...model.workspaces.values()].find((w) => w.path === repo)!;
});

const startSession = (
  workspace: Workspace,
  sessionId: SessionId,
  harness: HarnessKind = "claude",
  placement: Extract<Command, { _tag: "StartSession" }>["placement"] = { _tag: "InPlace" }
) =>
  dispatch({
    _tag: "StartSession",
    sessionId,
    workspaceId: workspace.id,
    harness,
    placement,
    permissionMode: "supervised",
    model: null,
    prompt: "Fix the flaky test",
    attachments: [],
  });

const setup = (options: { drivers: ReadonlyArray<FakeDriver>; idleTimeout?: Duration.Input }) => {
  const fakes = makeFakes();
  const filename = join(tempDir(), "state.sqlite");
  const layer = engineLayer({ filename, fakes, ...options });

  return { fakes, filename, layer };
};

describe("commands", () => {
  test("a retried commandId is applied once and returns the original result", async () => {
    const { layer } = setup({ drivers: [makeFakeDriver("claude")] });
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine;
        const store = yield* EventStore;
        const repo = fakeRepo();
        const commandId = cid();
        const command: Command = { _tag: "RegisterWorkspace", path: repo, name: "repo" };
        const first = yield* engine.dispatch({ commandId, command, deviceLabel: "a" });
        const second = yield* engine.dispatch({ commandId, command, deviceLabel: "a" });
        expect(first.sequence).not.toBeNull();
        expect(second.sequence).toEqual(first.sequence);
        const model = yield* store.model;
        expect(model.workspaces.size).toBe(1);
        expect(model.sequence).toBe(first.sequence!);

        // A rejection is also remembered: the retry fails the same way even though
        // the same command under a fresh id would now succeed.
        const rejectedId = cid();

        const missing: Command = {
          _tag: "RegisterWorkspace",
          path: join(repo, "nope"),
          name: null,
        };

        const r1 = yield* Effect.flip(
          engine.dispatch({ commandId: rejectedId, command: missing, deviceLabel: "a" })
        );

        expect(r1._tag).toBe("CommandRejected");

        const r2 = yield* Effect.flip(
          engine.dispatch({ commandId: rejectedId, command: missing, deviceLabel: "a" })
        );

        expect(r2).toEqual(r1);
      })
    );
  });

  test("SendTurn is rejected while Working; Continue needs an Interrupted Turn", async () => {
    const codex = makeFakeDriver("codex");
    const { layer } = setup({ drivers: [codex] });
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;
        const s = sid("s-working");
        yield* startSession(workspace, s, "codex");
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");

        const busy = yield* Effect.flip(
          dispatch({ _tag: "SendTurn", sessionId: s, prompt: "more", attachments: [] })
        );

        expect(busy._tag).toBe("CommandRejected");
        const cont = yield* Effect.flip(dispatch({ _tag: "Continue", sessionId: s }));
        expect(cont._tag).toBe("CommandRejected");

        const missing = yield* Effect.flip(
          dispatch({ _tag: "SendTurn", sessionId: sid("nope"), prompt: "x", attachments: [] })
        );

        expect(missing._tag).toBe("NotFound");
      })
    );
  });

  test("a Turn runs: checkpoints before and after, items, cursor, Idle", async () => {
    const claude = makeFakeDriver("claude", { onTurn: completesTurns("claude-session-1") });
    const { layer, fakes } = setup({ drivers: [claude] });
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;
        const s = sid("s-run");
        yield* startSession(workspace, s);
        const model = yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle");
        const record = model.sessions.get(s)!;
        expect(record.session.harnessCursor).toBe("claude-session-1");
        expect(record.session.title).toBe("Fix the flaky test");
        const [turn] = record.turns;
        expect(turn!.status).toBe("completed");
        expect(turn!.checkpointBefore).toEndWith("/before");
        expect(turn!.checkpointAfter).toEndWith("/after");
        expect(fakes.checkpoints.map((c) => c.label)).toEqual(["before", "after"]);
        expect(claude.latest(s)!.options.cwd).toBe(workspace.path);
        expect(claude.latest(s)!.options.resumeCursor).toBeNull();
      })
    );
  });

  test("Harness title suggestions apply until the user renames", async () => {
    const claude = makeFakeDriver("claude");
    const { layer } = setup({ drivers: [claude] });
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;
        const s = sid("s-title");
        yield* startSession(workspace, s);
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        claude.latest(s)!.emit({ _tag: "TitleSuggested", title: "Stabilize CI" });
        yield* waitFor((m) => m.sessions.get(s)?.session.title === "Stabilize CI");
        yield* dispatch({ _tag: "RenameSession", sessionId: s, title: "Mine" });
        claude.latest(s)!.emit({ _tag: "TitleSuggested", title: "Something else" });
        yield* Effect.sleep(Duration.millis(30));
        const model = yield* waitFor((m) => m.sessions.get(s)?.session.title === "Mine");
        expect(model.sessions.get(s)!.titleLocked).toBe(true);
      })
    );
  });
});

describe("approvals", () => {
  test("two Clients answer at once: the first wins, the other is rejected", async () => {
    const codex = makeFakeDriver("codex");
    const { layer } = setup({ drivers: [codex] });
    await run(
      layer,
      Effect.gen(function* () {
        const store = yield* EventStore;
        const workspace = yield* registerWorkspace;
        const s = sid("s-approval");
        yield* startSession(workspace, s, "codex");
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        const harness = codex.latest(s)!;
        const turnId = harness.turns[0]!.turnId;
        const requestId = "req-1" as RequestId;
        harness.emit({
          _tag: "ApprovalRequested",
          turnId,
          requestId,
          kind: "command",
          title: "Run bun test",
          detail: null,
          options: [],
        });
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "needs-you");

        const answer = (device: string) =>
          dispatch(
            {
              _tag: "RespondToApproval",
              sessionId: s,
              requestId,
              decision: { _tag: "Allow", remember: false },
            },
            device
          ).pipe(Effect.exit);

        const [a, b] = yield* Effect.all([answer("MacBook"), answer("iPhone")], {
          concurrency: "unbounded",
        });

        const outcomes = [a, b].map((exit) => Exit.isSuccess(exit));
        expect(outcomes.filter(Boolean)).toHaveLength(1);
        const loser = Exit.isSuccess(a) ? b : a;
        expect(Exit.isFailure(loser)).toBe(true);
        const winnerLabel = Exit.isSuccess(a) ? "MacBook" : "iPhone";

        const model = yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        expect(model.sessions.get(s)!.pending.size).toBe(0);
        const events = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: s });
        const resolved = events.filter((e) => e.event._tag === "ApprovalResolved");
        expect(resolved).toHaveLength(1);
        expect(resolved[0]!.event).toMatchObject({ resolvedBy: winnerLabel });
        yield* waitUntil(() => harness.responses.length === 1);
        expect(harness.responses[0]!.requestId).toBe(requestId);
      })
    );
  });
});

describe("streams", () => {
  test("resume from afterSequence has no gaps and no duplicates under concurrent writes", async () => {
    const claude = makeFakeDriver("claude", { onTurn: completesTurns() });
    const { layer } = setup({ drivers: [claude] });
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine;
        const store = yield* EventStore;
        const workspace = yield* registerWorkspace;
        const s = sid("s-stream");
        yield* startSession(workspace, s);
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle");
        const base = (yield* store.model).sequence;

        const writes = yield* Effect.forEach(
          Array.from({ length: 80 }, (_, i) => i),
          (i) => dispatch({ _tag: "RenameSession", sessionId: s, title: `title ${i}` }),
          { concurrency: 8 }
        ).pipe(Effect.forkChild);

        // Subscribe while the writes are in flight, resuming from before them.
        yield* waitFor((m) => m.sequence >= base + 10);
        const hostItems: Array<HostStreamItem> = [];
        const sessionItems: Array<SessionStreamItem> = [];

        const hostFiber = yield* Stream.runForEach(engine.subscribeHost(base as never), (item) =>
          Effect.sync(() => void hostItems.push(item))
        ).pipe(Effect.forkChild);

        const sessionFiber = yield* Stream.runForEach(
          engine.subscribeSession({ sessionId: s, afterSequence: base as never, turnLimit: null }),
          (item) => Effect.sync(() => void sessionItems.push(item))
        ).pipe(Effect.forkChild);

        yield* Fiber.join(writes);
        const final = (yield* store.model).sequence;
        expect(final).toBe(base + 80);

        const seqs = (items: ReadonlyArray<HostStreamItem | SessionStreamItem>) =>
          items.flatMap((item) =>
            item._tag === "Event" ? [item.envelope.sequence as number] : []
          );

        yield* waitUntil(
          () => seqs(hostItems).at(-1) === final && seqs(sessionItems).at(-1) === final
        );
        yield* Fiber.interrupt(hostFiber);
        yield* Fiber.interrupt(sessionFiber);

        const expected = Array.from({ length: 80 }, (_, i) => base + 1 + i);
        expect(seqs(hostItems)).toEqual(expected);
        expect(seqs(sessionItems)).toEqual(expected);
        expect(hostItems.filter((i) => i._tag === "Synchronized")).toHaveLength(1);
        expect(hostItems.some((i) => i._tag === "Snapshot")).toBe(false);
      })
    );
  });

  test("a fresh subscription gets a snapshot, then live events and Deltas", async () => {
    const codex = makeFakeDriver("codex");
    const { layer } = setup({ drivers: [codex] });
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine;
        const workspace = yield* registerWorkspace;
        const s = sid("s-snapshot");
        yield* startSession(workspace, s, "codex");
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        const harness = codex.latest(s)!;
        const turnId = harness.turns[0]!.turnId;
        // The Claude driver completes a tool item twice under one id: it must show once.
        harness.emit(
          {
            _tag: "ItemCompleted",
            turnId,
            item: {
              _tag: "ToolCall",
              id: "t1",
              name: "Read",
              input: {},
              output: null,
              status: "running",
            },
          },
          {
            _tag: "ItemCompleted",
            turnId,
            item: {
              _tag: "ToolCall",
              id: "t1",
              name: "Read",
              input: {},
              output: "ok",
              status: "completed",
            },
          }
        );
        yield* Effect.sleep(Duration.millis(30));

        const items: Array<SessionStreamItem> = [];

        const fiber = yield* Stream.runForEach(
          engine.subscribeSession({ sessionId: s, afterSequence: null, turnLimit: 5 }),
          (item) => Effect.sync(() => void items.push(item))
        ).pipe(Effect.forkChild);

        yield* waitUntil(() => items.some((i) => i._tag === "Synchronized"));
        harness.emit({ _tag: "ItemDelta", turnId, itemId: "m1", field: "text", text: "Hel" });
        harness.emit({ _tag: "TurnEnded", turnId, status: "completed", error: null });
        yield* waitUntil(() =>
          items.some((i) => i._tag === "Event" && i.envelope.event._tag === "TurnEnded")
        );
        yield* Fiber.interrupt(fiber);

        const snapshot = items[0]!;
        expect(snapshot._tag).toBe("Snapshot");

        if (snapshot._tag !== "Snapshot") return;
        expect(snapshot.turns).toHaveLength(1);
        expect(snapshot.turns[0]!.items).toHaveLength(1);
        expect(snapshot.turns[0]!.items[0]).toMatchObject({ id: "t1", status: "completed" });
        expect(items[1]!._tag).toBe("Synchronized");
        expect(items.some((i) => i._tag === "Delta" && i.text === "Hel")).toBe(true);

        const missing = yield* engine
          .subscribeSession({ sessionId: sid("nope"), afterSequence: null, turnLimit: null })
          .pipe(Stream.runCollect, Effect.flip);

        expect(missing._tag).toBe("NotFound");
      })
    );
  });
});

describe("supervision", () => {
  test("Idle → Dormant after the idle timeout; the next SendTurn resumes from the cursor", async () => {
    const claude = makeFakeDriver("claude", { onTurn: completesTurns("cursor-A") });
    const { layer } = setup({ drivers: [claude], idleTimeout: Duration.millis(40) });
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;
        const s = sid("s-idle");
        yield* startSession(workspace, s);
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle");
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "dormant");
        expect(claude.sessions).toHaveLength(1);
        expect(claude.sessions[0]!.closed).toBe(true);

        yield* dispatch({ _tag: "SendTurn", sessionId: s, prompt: "and again", attachments: [] });

        const model = yield* waitFor(
          (m) =>
            m.sessions.get(s)?.turns.length === 2 && m.sessions.get(s)?.session.state === "idle"
        );

        expect(claude.sessions).toHaveLength(2);
        expect(claude.sessions[1]!.options.resumeCursor).toBe("cursor-A");
        expect(model.sessions.get(s)!.turns[1]!.status).toBe("completed");
      })
    );
  });

  test("a Harness that exits with an error fails the session and its Turn", async () => {
    const codex = makeFakeDriver("codex");
    const { layer } = setup({ drivers: [codex] });
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;
        const s = sid("s-crash");
        yield* startSession(workspace, s, "codex");
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "working");
        codex.latest(s)!.emit({ _tag: "Exited", error: "segfault" });
        const model = yield* waitFor((m) => m.sessions.get(s)?.session.state === "failed");
        expect(model.sessions.get(s)!.session.lastError).toBe("segfault");
        expect(model.sessions.get(s)!.turns[0]!.status).toBe("failed");
      })
    );
  });

  test("Open in terminal closes Claude's Harness but keeps Codex attached", async () => {
    const claude = makeFakeDriver("claude", { onTurn: completesTurns("c1") });
    const codex = makeFakeDriver("codex", { liveCoAttach: true, onTurn: completesTurns("x1") });
    const { layer } = setup({ drivers: [claude, codex] });
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine;
        const workspace = yield* registerWorkspace;
        const a = sid("s-claude");
        const b = sid("s-codex");
        yield* startSession(workspace, a, "claude");
        yield* startSession(workspace, b, "codex");
        yield* waitFor(
          (m) =>
            m.sessions.get(a)?.session.state === "idle" &&
            m.sessions.get(b)?.session.state === "idle"
        );
        yield* dispatch({ _tag: "OpenInTerminal", sessionId: a });
        yield* dispatch({ _tag: "OpenInTerminal", sessionId: b });
        yield* waitUntil(() => claude.sessions[0]!.closed);
        yield* waitFor((m) => m.sessions.get(b)?.session.state === "in-terminal");
        yield* Effect.sleep(Duration.millis(20));
        expect(codex.sessions[0]!.closed).toBe(false);
        expect(yield* engine.terminalCommand(a)).toMatchObject({
          argv: ["claude", "--resume", "new"],
          cwd: workspace.path,
          env: {},
        });

        const rejected = yield* Effect.flip(
          dispatch({ _tag: "SendTurn", sessionId: a, prompt: "x", attachments: [] })
        );

        expect(rejected._tag).toBe("CommandRejected");

        yield* dispatch({ _tag: "ReturnFromTerminal", sessionId: a });
        yield* dispatch({ _tag: "ReturnFromTerminal", sessionId: b });
        yield* waitFor(
          (m) =>
            m.sessions.get(a)?.session.state === "idle" &&
            m.sessions.get(b)?.session.state === "idle"
        );
        expect(claude.sessions).toHaveLength(2);
        expect(claude.sessions[1]!.options.resumeCursor).toBe("c1");
        expect(codex.sessions).toHaveLength(1);
      })
    );
  });
});

describe("restart recovery", () => {
  test("a Working Turn becomes Interrupted and the session Needs You; Idle goes Dormant", async () => {
    const fakes = makeFakes();
    const filename = join(tempDir(), "state.sqlite");
    const s1 = sid("s-mid-turn");
    const s2 = sid("s-idle-before");
    let turnId: TurnId | undefined;

    const codex1 = makeFakeDriver("codex");
    const claude1 = makeFakeDriver("claude", { onTurn: completesTurns() });
    await run(
      engineLayer({ filename, fakes, drivers: [codex1, claude1] }),
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;
        yield* startSession(workspace, s1, "codex");
        yield* startSession(workspace, s2, "claude");
        yield* waitFor(
          (m) =>
            m.sessions.get(s1)?.session.state === "working" &&
            m.sessions.get(s2)?.session.state === "idle"
        );
        const harness = codex1.latest(s1)!;
        turnId = harness.turns[0]!.turnId;
        harness.emit(
          { _tag: "CursorAssigned", cursor: "thread-9" },
          {
            _tag: "ApprovalRequested",
            turnId,
            requestId: "req-9" as RequestId,
            kind: "file-change",
            title: "Edit a file",
            detail: null,
            options: [],
          }
        );
        yield* waitFor((m) => m.sessions.get(s1)?.session.state === "needs-you");
        // The Daemon goes away here: the layer closes without the Harness reporting anything.
      })
    );

    const codex2 = makeFakeDriver("codex");
    const claude2 = makeFakeDriver("claude");
    await run(
      engineLayer({ filename, fakes, drivers: [codex2, claude2] }),
      Effect.gen(function* () {
        const store = yield* EventStore;
        const model = yield* store.model;
        const r1 = model.sessions.get(s1)!;
        expect(r1.session.state).toBe("needs-you");
        expect(r1.turns[0]!.status).toBe("interrupted");
        expect(r1.pending.size).toBe(0);
        expect(model.sessions.get(s2)!.session.state).toBe("dormant");
        // Never continued automatically.
        expect(codex2.sessions).toHaveLength(0);
        expect(claude2.sessions).toHaveLength(0);

        yield* dispatch({ _tag: "Continue", sessionId: s1 });
        yield* waitFor((m) => m.sessions.get(s1)?.session.state === "working");
        const resumed = codex2.latest(s1)!;
        expect(resumed.options.resumeCursor).toBe("thread-9");
        expect(resumed.turns[0]).toMatchObject({ turnId, prompt: CONTINUE_PROMPT });
        expect((yield* store.model).sessions.get(s1)!.turns).toHaveLength(1);
      })
    );
  });
});

describe("fork and archive", () => {
  test("ForkSession links the new session to its parent and Turn", async () => {
    const claude = makeFakeDriver("claude", { onTurn: completesTurns() });
    const codex = makeFakeDriver("codex");
    const { layer } = setup({ drivers: [claude, codex] });
    await run(
      layer,
      Effect.gen(function* () {
        const engine = yield* Engine;
        const workspace = yield* registerWorkspace;
        const parent = sid("s-parent");
        yield* startSession(workspace, parent);
        const model = yield* waitFor((m) => m.sessions.get(parent)?.session.state === "idle");
        const turnId = model.sessions.get(parent)!.turns[0]!.id;
        const child = sid("s-child");
        yield* dispatch({
          _tag: "ForkSession",
          sessionId: child,
          fromSessionId: parent,
          fromTurnId: turnId,
          harness: "codex",
        });
        const after = yield* waitFor((m) => m.sessions.has(child));
        const fork = after.sessions.get(child)!.session;
        expect(fork).toMatchObject({
          parentSessionId: parent,
          forkedFromTurnId: turnId,
          harness: "codex",
          state: "dormant",
          harnessCursor: null,
        });

        const [snapshot] = yield* engine
          .subscribeHost(null)
          .pipe(Stream.take(1), Stream.runCollect);

        expect(
          snapshot?._tag === "Snapshot" && snapshot.sessions.map((x) => x.session.id)
        ).toContain(child);
      })
    );
  });

  test("ArchiveSession removes the session's Worktree, keeps the branch, cleans attachments", async () => {
    const claude = makeFakeDriver("claude", { onTurn: completesTurns() });
    const { layer, fakes } = setup({ drivers: [claude] });
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;
        const s = sid("s-archive");
        yield* startSession(workspace, s, "claude", {
          _tag: "NewWorktree",
          branch: "fix/flaky",
          baseRef: null,
        });
        const model = yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle");
        const cwd = join(workspace.worktreeRoot, "fix/flaky");
        expect(model.sessions.get(s)!.session.cwd).toBe(cwd);
        expect(claude.latest(s)!.options.cwd).toBe(cwd);
        const worktree = model.worktrees.get(model.sessions.get(s)!.session.worktreeId!)!;
        expect(worktree).toMatchObject({ path: cwd, branch: "fix/flaky", createdBySessionId: s });

        yield* dispatch({ _tag: "ArchiveSession", sessionId: s, deleteMergedBranch: false });
        yield* waitFor(
          (m) => m.sessions.get(s)?.session.state === "archived" && m.worktrees.size === 0
        );
        yield* waitUntil(() => fakes.archived.includes(s));
        expect(fakes.worktreeCalls).toEqual([
          { op: "create", path: cwd, detail: { branch: "fix/flaky", baseRef: null } },
          { op: "remove", path: cwd, detail: { deleteBranchIfMerged: false } },
        ]);
        expect(claude.latest(s)!.closed).toBe(true);

        const again = yield* Effect.flip(
          dispatch({ _tag: "ArchiveSession", sessionId: s, deleteMergedBranch: false })
        );

        expect(again._tag).toBe("CommandRejected");
        // Unarchive brings the Worktree back from the branch Archive kept.
        yield* dispatch({ _tag: "UnarchiveSession", sessionId: s });

        const restored = yield* waitFor(
          (m) => m.sessions.get(s)?.session.state === "dormant" && m.worktrees.size === 1
        );

        expect(fakes.worktreeCalls.at(-1)).toEqual({
          op: "create",
          path: cwd,
          detail: { branch: "fix/flaky", baseRef: null },
        });
        expect([...restored.worktrees.values()][0]).toMatchObject({
          path: cwd,
          branch: "fix/flaky",
          createdBySessionId: s,
        });
        yield* dispatch({ _tag: "SendTurn", sessionId: s, prompt: "again", attachments: [] });
        yield* waitFor((m) => m.sessions.get(s)?.session.state === "idle");
        expect(claude.latest(s)!.options.cwd).toBe(cwd);
      })
    );
  });
});
