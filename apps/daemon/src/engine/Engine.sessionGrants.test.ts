import { sessionsTool } from "../mcp/tools/history.ts";
import { sessionTools } from "../mcp/sessions/index.ts";
import { sessionControl } from "../mcp/sessions/control.ts";
import { EventJson } from "../store/eventJson.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  ApprovalDecision,
  AgentSession,
  DomainEvent,
  Command,
  RequestId,
  SessionId,
  SessionPlacement,
  Starter,
} from "@polaris/protocol";
import { Effect, Fiber, Result, Schema, Struct, Predicate } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

const root = SessionId.make("starter");

const setup = Effect.gen(function* () {
  const engine = yield* Engine;
  yield* engine.dispatch({
    commandId: cid(),
    deviceLabel: "test",
    command: Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }),
  });
  const store = yield* EventStore;
  const workspace = [...(yield* store.model).workspaces.values()][0]!;

  const start = (sessionId: SessionId, agentSessionId?: SessionId) =>
    engine.dispatch({
      commandId: cid(),
      deviceLabel: "test",
      agentSessionId,
      command: Command.cases.StartSession.make({
        sessionId,
        workspaceId: workspace.id,
        harness: "codex",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "Work",
        attachments: [],
      }),
    });

  yield* start(root);
  yield* waitFor((m) => m.sessions.get(root)?.session.state === "working");

  const allow = (
    sessionId: SessionId,
    remember: boolean,
    grantScope: "session" | "workspace" = "session"
  ) =>
    Effect.gen(function* () {
      const model = yield* waitFor((m) =>
        [...(m.sessions.get(sessionId)?.pending.values() ?? [])].some((r) => r.kind === "grant")
      );

      const request = [...model.sessions.get(sessionId)!.pending.values()].find(
        (r) => r.kind === "grant"
      )!;

      yield* engine.dispatch({
        commandId: cid(),
        deviceLabel: "test",
        command: Command.cases.RespondToApproval.make({
          sessionId,
          requestId: request.id,
          decision: ApprovalDecision.cases.Allow.make(
            remember ? { remember, grantScope } : { remember }
          ),
        }),
      });
    });

  return { engine, store, start, allow };
});

const run = (program: Effect.Effect<void, unknown, Engine | EventStore>) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(
        engineLayer({
          filename: join(tempDir(), "state.sqlite"),
          fakes: makeFakes(),
          drivers: [makeFakeDriver("codex")],
        })
      )
    )
  );

test("an agent start asks; always for this session persists authority and the sixth start is refused", () =>
  run(
    Effect.gen(function* () {
      const { store, start, allow, engine } = yield* setup;
      const first = SessionId.make("child-1");
      const pending = yield* Effect.forkChild(start(first, root));
      yield* waitFor((m) => m.sessions.get(root)?.session.state === "needs-you");
      expect((yield* store.model).sessions.has(first)).toBe(false);
      yield* allow(root, true);
      yield* Fiber.join(pending);
      expect((yield* store.model).sessions.get(first)?.session.starter).toEqual(
        Starter.cases.AgentSession.make({ sessionId: root })
      );

      for (let i = 2; i <= 5; i++) yield* start(SessionId.make(`child-${i}`), root);
      expect((yield* store.model).sessions.get(root)?.pending.size).toBe(0);
      const refused = yield* Effect.result(start(SessionId.make("child-6"), root));
      expect(
        Result.isFailure(refused) &&
          ("reason" in refused.failure ? refused.failure.reason : refused.failure.message)
      ).toContain("start budget of 5");
      yield* engine.setSessionStartLimit(root, 6);
      yield* start(SessionId.make("child-6"), root);
      expect((yield* store.model).sessions.size).toBe(7);
    })
  ));

test("nested starts count against every Starter and another session's Turn always asks", () =>
  run(
    Effect.gen(function* () {
      const { store, start, allow, engine } = yield* setup;
      const child = SessionId.make("child");
      const starting = yield* Effect.forkChild(start(child, root));
      yield* allow(root, true, "workspace");
      yield* Fiber.join(starting);
      yield* waitFor((m) => m.sessions.get(child)?.session.state === "working");

      for (let i = 0; i < 4; i++) yield* start(SessionId.make(`grandchild-${i}`), child);
      const refused = yield* Effect.result(start(SessionId.make("too-deep"), child));
      expect(
        Result.isFailure(refused) &&
          ("reason" in refused.failure ? refused.failure.reason : refused.failure.message)
      ).toContain("starter has reached its start budget");
      const outsider = SessionId.make("outsider");
      yield* start(outsider);

      const sending = yield* Effect.forkChild(
        engine.authorizeSessionAction(root, {
          rpc: "dispatch",
          command: Command.cases.Interrupt.make({ sessionId: outsider }),
        })
      );

      const model = yield* waitFor((m) => m.sessions.get(root)?.pending.size === 1);
      expect([...model.sessions.get(root)!.pending.values()][0]!.grant?.rememberable).toBe(false);
      yield* allow(root, false);
      yield* Fiber.join(sending);
      expect((yield* store.model).sessions.get(root)?.session.grant).not.toContain("turn");
    })
  ));

test("session authority cannot approve its own request", () =>
  run(
    Effect.gen(function* () {
      const { engine } = yield* setup;

      const result = yield* Effect.result(
        engine.authorizeSessionAction(root, {
          rpc: "dispatch",
          command: Command.cases.RespondToApproval.make({
            sessionId: root,
            requestId: RequestId.make("request"),
            decision: ApprovalDecision.cases.Allow.make({ remember: true }),
          }),
        })
      );

      expect(Result.isFailure(result) && result.failure.message).toContain("Only the user");
    })
  ));

test("concurrent starts serialize against the remaining slot", () =>
  run(
    Effect.gen(function* () {
      const { start, allow, store } = yield* setup;
      const first = yield* Effect.forkChild(start(SessionId.make("first"), root));
      yield* allow(root, true);
      yield* Fiber.join(first);

      for (let i = 0; i < 3; i++) yield* start(SessionId.make(`existing-${i}`), root);

      const outcomes = yield* Effect.forEach(
        ["race-a", "race-b"],
        (name) => Effect.result(start(SessionId.make(name), root)),
        { concurrency: 2 }
      );

      expect(outcomes.filter(Result.isSuccess)).toHaveLength(1);
      expect(outcomes.filter(Result.isFailure)).toHaveLength(1);
      expect((yield* store.model).sessions.size).toBe(6);
    })
  ));

test("a remembered settings Grant cannot change authority or provide secrets", () =>
  run(
    Effect.gen(function* () {
      const { engine, allow } = yield* setup;

      const first = yield* Effect.forkChild(
        engine.authorizeSessionAction(root, { rpc: "settings.set", settingKey: "visuals.level" })
      );

      yield* allow(root, true);
      yield* Fiber.join(first);
      yield* engine.authorizeSessionAction(root, {
        rpc: "settings.set",
        settingKey: "sessions.defaults",
      });

      for (const action of [
        { rpc: "settings.set", settingKey: "sessions.startLimit" },
        { rpc: "secret.provide" },
      ]) {
        const result = yield* Effect.result(engine.authorizeSessionAction(root, action));
        expect(Result.isFailure(result) && result.failure.message).toContain("Only the user");
      }
    })
  ));

test("abandoning a Grant Approval withdraws it without starting the session", () =>
  run(
    Effect.gen(function* () {
      const { start, store } = yield* setup;
      const pending = yield* Effect.forkChild(start(SessionId.make("abandoned"), root));
      yield* waitFor((m) => m.sessions.get(root)?.pending.size === 1);
      yield* Fiber.interrupt(pending);
      const model = yield* store.model;
      expect(model.sessions.get(root)?.pending.size).toBe(0);
      expect(model.sessions.has(SessionId.make("abandoned"))).toBe(false);
    })
  ));

test("session and Workspace Grants, Starter and both limits survive reopening the store", async () => {
  const filename = join(tempDir(), "grants.sqlite");
  await Effect.runPromise(
    Effect.gen(function* () {
      const { start, allow, engine } = yield* setup;
      const pending = yield* Effect.forkChild(start(SessionId.make("persisted-child"), root));
      yield* allow(root, true);
      yield* Fiber.join(pending);

      const settings = yield* Effect.forkChild(
        engine.authorizeSessionAction(root, { rpc: "settings.set", settingKey: "visuals.level" })
      );

      yield* allow(root, true, "workspace");
      yield* Fiber.join(settings);
      yield* engine.setSessionStartLimit(null, 8);
      yield* engine.setSessionStartLimit(root, 9);
    }).pipe(
      Effect.provide(
        engineLayer({ filename, fakes: makeFakes(), drivers: [makeFakeDriver("codex")] })
      )
    )
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const model = yield* (yield* EventStore).model;
      expect(model.sessions.get(root)?.session.grant).toContain("start");
      expect([...model.workspaces.values()][0]?.sessionGrant).toContain("settings");
      expect(model.sessionStartLimit).toBe(8);
      expect(model.sessions.get(root)?.session.startLimit).toBe(9);
      expect(model.sessions.get(SessionId.make("persisted-child"))?.session.starter).toEqual(
        Starter.cases.AgentSession.make({ sessionId: root })
      );
    }).pipe(Effect.provide(EventStore.layerSqlite(filename)))
  );
});

test("the generated sessions tool starts on the caller's Host with Host session defaults after approval", () =>
  run(
    Effect.gen(function* () {
      const { store, engine, allow } = yield* setup;

      const tool = sessionsTool(root, {
        ...sessionTools(store),
        control: sessionControl(store, engine, () => ({
          model: "host-model",
          effort: "high",
          permissionMode: "plan",
        })),
      });

      const refused = yield* Effect.promise(() =>
        tool.call({ verb: "start", prompt: "Work", host: "other-host" })
      );

      expect(refused.isError).toBe(true);

      const starting = yield* Effect.forkChild(
        Effect.promise(() => tool.call({ verb: "start", prompt: "Lead the next part" }))
      );

      yield* allow(root, false);
      const result = yield* Fiber.join(starting);
      expect(result.isError).not.toBe(true);
      const model = yield* store.model;

      const child = [...model.sessions.values()].find(
        (record) => record.session.id !== root
      )!.session;

      expect({
        workspace: child.workspaceId,
        harness: child.harness,
        model: child.model,
        effort: child.effort,
        mode: child.permissionMode,
      }).toEqual({
        workspace: model.sessions.get(root)!.session.workspaceId,
        harness: "codex",
        model: "host-model",
        effort: "high",
        mode: "plan",
      });
    })
  ));

test("a sessions tool cancellation withdraws its Grant Approval", () =>
  run(
    Effect.gen(function* () {
      const { store, engine } = yield* setup;

      const tool = sessionsTool(root, {
        ...sessionTools(store),
        control: sessionControl(store, engine),
      });

      const controller = new AbortController();

      const call = tool
        .call({ verb: "start", prompt: "This call is abandoned" }, controller.signal)
        .catch(() => null);

      yield* waitFor((m) => m.sessions.get(root)?.pending.size === 1);
      controller.abort();
      yield* Effect.promise(() => call);
      const model = yield* store.model;
      expect(model.sessions.get(root)?.pending.size).toBe(0);
      expect(model.sessions.size).toBe(1);
    })
  ));

test("old SessionCreated events decode with the user Starter and read/comment Grant", () =>
  run(
    Effect.gen(function* () {
      const { store } = yield* setup;
      const session = (yield* store.model).sessions.get(root)!.session;
      const event = DomainEvent.cases.SessionCreated.make({ session });

      const wire = JSON.stringify({
        ...Struct.omit(event, ["starter"]),
        session: Struct.omit(Schema.encodeSync(AgentSession)(session), [
          "starter",
          "grant",
          "startLimit",
        ]),
      });

      const decoded = EventJson.decode(wire);

      if (!Predicate.isTagged(decoded, "SessionCreated")) throw new Error("wrong event");
      expect(decoded.starter).toEqual(Starter.cases.User.make({}));
      expect(decoded.session.grant).toEqual(["read", "comment"]);
    })
  ));
