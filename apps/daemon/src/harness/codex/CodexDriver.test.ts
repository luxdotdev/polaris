import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ApprovalDecision,
  type PermissionMode,
  RequestId,
  SessionId,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import { Effect, Schema, Stream } from "effect";
import { HarnessEvent, type HarnessSession } from "../HarnessDriver.ts";
import { makeCodexDriver, probeCodex } from "./CodexDriver.ts";
import type { Json } from "./protocol.ts";
import {
  type ClientAnswer,
  type ClientRequest,
  type FakeAppServer,
  type FakeConnection,
  type Handler,
  readFixture,
  replay,
  startFakeAppServer,
} from "./testing/FakeAppServer.ts";

const THREAD = "thr_1";

type EventOf<T extends HarnessEvent["_tag"]> = Extract<HarnessEvent, { readonly _tag: T }>;

const ofTag = <T extends HarnessEvent["_tag"]>(
  events: ReadonlyArray<HarnessEvent>,
  tag: T
): Array<EventOf<T>> => events.filter(HarnessEvent.$is(tag));

const decodeThreadId = Schema.decodeUnknownSync(Schema.Struct({ threadId: Schema.String }));

const decodeTurnInput = Schema.decodeUnknownSync(
  Schema.Struct({ input: Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) })) })
);

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

/** Socket paths must stay under ~104 bytes, so tests use /tmp directly. */
const socketPath = () => {
  const dir = mkdtempSync("/tmp/pcx-");
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  return join(dir, "s.sock");
};

interface Harness {
  readonly session: HarnessSession;
  readonly server: FakeAppServer;
  readonly events: Array<HarnessEvent>;
  /** The first event with `tag` (and matching `where`), waiting up to two seconds. */
  readonly waitFor: <T extends HarnessEvent["_tag"]>(
    tag: T,
    where?: (e: EventOf<T>) => boolean
  ) => Effect.Effect<EventOf<T>>;
}

/** Opens a session against a fake app-server and runs `body`; the scope closes afterwards. */
const withSession = <A>(
  handler: Handler,
  body: (h: Harness) => Effect.Effect<A, unknown>,
  options: { readonly resumeCursor?: string; readonly permissionMode?: PermissionMode } = {}
): Promise<{ result: A; events: Array<HarnessEvent>; server: FakeAppServer }> => {
  const path = socketPath();
  const server = startFakeAppServer(path, handler);
  cleanup.push(server.stop);
  const events: Array<HarnessEvent> = [];

  const program = Effect.gen(function* () {
    const driver = yield* makeCodexDriver({
      socketPath: path,
      spawnAppServer: false,
      codexPath: "/opt/codex/bin/codex",
    });

    const session = yield* driver.open({
      sessionId: SessionId.make("s1"),
      cwd: "/repo",
      permissionMode: options.permissionMode ?? "supervised",
      model: null,
      resumeCursor: options.resumeCursor ?? null,
    });

    yield* session.events.pipe(
      Stream.runForEach((e) => Effect.sync(() => events.push(e))),
      // Detached, so it keeps reading through scope close and sees the final `Exited`.
      Effect.forkDetach
    );

    const waitFor = <T extends HarnessEvent["_tag"]>(
      tag: T,
      where: (e: EventOf<T>) => boolean = () => true
    ) =>
      Effect.promise(async () => {
        for (let i = 0; i < 200; i++) {
          const found = ofTag(events, tag).find(where);

          if (found) return found;
          await Bun.sleep(10);
        }

        throw new Error(`timed out waiting for ${tag}; saw ${events.map((e) => e._tag).join(",")}`);
      });

    return yield* body({ session, server, events, waitFor });
  });

  return Effect.runPromise(Effect.scoped(program)).then(async (result) => {
    await Bun.sleep(20);

    return { result, events, server };
  });
};

/** A handler for the handshake and thread lifecycle, delegating the rest. */
const scripted =
  (rest: (request: ClientRequest, conn: FakeConnection) => void | Promise<void>): Handler =>
  (request, conn) => {
    switch (request.method) {
      case "initialize":
        return conn.reply({ userAgent: "fake", codexHome: "/home/user/.codex" });
      case "thread/start":
        return conn.reply({ thread: { id: THREAD } });
      case "thread/resume":
        return conn.reply({ thread: { id: decodeThreadId(request.params).threadId } });
      case "thread/unsubscribe":
        return conn.reply({ status: "unsubscribed" });
      default:
        return rest(request, conn);
    }
  };

const turn = (id: string, status = "inProgress", error: Json = null) => ({
  id,
  items: [],
  itemsView: "notLoaded",
  status,
  error,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});

describe("Codex driver against a fake app-server", () => {
  test("replays a recorded full Turn", async () => {
    const frames = await readFixture(join(import.meta.dir, "fixtures/full-turn.jsonl"));

    const { events, server } = await withSession(replay(frames), ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({
          turnId: TurnId.make("turn-1"),
          prompt: "say ok",
          attachments: [],
        });
        yield* waitFor("TurnEnded");
      })
    );

    const threadId = "01a0e68a-7f27-7583-8ddc-d1194aeb14f4";
    const messageId = "msg_0829498457dd13ad016ab9fe9bc67087d1a552d9ba43c74252";
    const turnId = TurnId.make("turn-1");
    expect(events.map((e) => e._tag)).toEqual([
      "CursorAssigned",
      "TurnStarted",
      "ItemDelta",
      "ItemCompleted",
      "TurnEnded",
      "Exited",
    ]);
    expect(events).toEqual([
      HarnessEvent.CursorAssigned({ cursor: threadId }),
      HarnessEvent.TurnStarted({ turnId, prompt: "say ok" }),
      HarnessEvent.ItemDelta({ turnId, itemId: messageId, field: "text", text: "ok" }),
      HarnessEvent.ItemCompleted({
        turnId,
        item: TurnItem.cases.AssistantMessage.make({ id: messageId, text: "ok" }),
      }),
      HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }),
      HarnessEvent.Exited({ error: null }),
    ]);
    expect(server.received.map((m) => m.method)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "thread/unsubscribe",
    ]);
    expect(server.requests("thread/start")[0]?.params).toMatchObject({
      cwd: "/repo",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: "read-only",
    });
  });

  test("an approval round-trip answers the server request", async () => {
    let approval: Promise<ClientAnswer> = Promise.resolve(null);

    const handler = scripted((request, conn) => {
      if (request.method !== "turn/start") return;
      conn.reply({ turn: turn("t1") });
      conn.notify("turn/started", { threadId: THREAD, turn: turn("t1") });
      approval = conn
        .request("item/commandExecution/requestApproval", {
          threadId: THREAD,
          turnId: "t1",
          itemId: "cmd1",
          startedAtMs: 0,
          kind: "command",
          environmentId: null,
          command: "bun test",
          cwd: "/repo",
          reason: "run the tests",
        })
        .then((answer) => {
          conn.notify("serverRequest/resolved", { threadId: THREAD, requestId: 1000 });
          conn.notify("item/completed", {
            threadId: THREAD,
            turnId: "t1",
            completedAtMs: 0,
            item: {
              type: "commandExecution",
              id: "cmd1",
              command: "bun test",
              cwd: "/repo",
              status: "completed",
              aggregatedOutput: "1 pass",
              exitCode: 0,
              commandActions: [],
              durationMs: 5,
            },
          });
          conn.notify("turn/completed", { threadId: THREAD, turn: turn("t1", "completed") });

          return answer;
        });
    });

    const { events } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({ turnId: TurnId.make("turn-1"), prompt: "test", attachments: [] });
        const asked = yield* waitFor("ApprovalRequested");
        expect(asked).toMatchObject({
          turnId: "turn-1",
          kind: "command",
          title: "bun test",
          detail: "run the tests",
        });
        yield* session.respond(
          asked.requestId,
          ApprovalDecision.cases.Allow.make({ remember: true })
        );
        yield* waitFor("TurnEnded");
        expect(yield* Effect.promise(() => approval)).toEqual({ decision: "acceptForSession" });

        // A second answer to the same request is rejected rather than sent twice.
        const again = yield* Effect.flip(
          session.respond(asked.requestId, ApprovalDecision.cases.Allow.make({ remember: false }))
        );

        expect(again.message).toContain("No open Codex request");
      })
    );

    // Our own answer's `serverRequest/resolved` is not reported as a withdrawal.
    expect(ofTag(events, "ApprovalWithdrawn")).toEqual([]);
    expect(ofTag(events, "ItemCompleted")[0]?.item).toEqual(
      TurnItem.cases.CommandExecution.make({
        id: "cmd1",
        command: "bun test",
        cwd: "/repo",
        output: "1 pass",
        exitCode: 0,
        status: "completed",
      })
    );
  });

  test("interrupt stops the Turn and withdraws its open approval", async () => {
    const handler = scripted((request, conn) => {
      switch (request.method) {
        case "turn/start":
          conn.reply({ turn: turn("t1") });
          conn.notify("turn/started", { threadId: THREAD, turn: turn("t1") });
          void conn.request("item/fileChange/requestApproval", {
            threadId: THREAD,
            turnId: "t1",
            itemId: "fc1",
            startedAtMs: 0,
            reason: null,
          });

          return;
        case "turn/interrupt":
          conn.reply({});
          conn.notify("serverRequest/resolved", { threadId: THREAD, requestId: 1000 });
          conn.notify("turn/completed", { threadId: THREAD, turn: turn("t1", "interrupted") });

          return;
      }
    });

    const { events, server } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({ turnId: TurnId.make("turn-1"), prompt: "edit", attachments: [] });
        const asked = yield* waitFor("ApprovalRequested");
        expect(asked).toMatchObject({ kind: "file-change", title: "Apply file changes" });
        yield* session.interrupt;
        yield* waitFor("TurnEnded");

        return asked.requestId;
      })
    );

    expect(server.requests("turn/interrupt")[0]?.params).toEqual({
      threadId: THREAD,
      turnId: "t1",
    });
    const tags = events.map((e) => e._tag);
    expect(tags.indexOf("ApprovalWithdrawn")).toBeLessThan(tags.indexOf("TurnEnded"));
    expect(ofTag(events, "TurnEnded")[0]).toMatchObject({ status: "interrupted" });
  });

  test("resume rejoins the thread and follows a Turn started elsewhere", async () => {
    const handler = scripted((request, conn) => {
      if (request.method === "turn/steer") {
        conn.reply({ turnId: "t_tui" });
        conn.notify("turn/completed", { threadId: THREAD, turn: turn("t_tui", "completed") });
      }
    });

    let sendThreadNotifications: (() => void) | null = null;

    const wrapped: Handler = (request, conn) => {
      if (request.method === "thread/resume")
        sendThreadNotifications = () => {
          // A Turn the co-attached TUI started: no turn/start from Polaris, and we rejoin mid-way.
          conn.notify("item/agentMessage/delta", {
            threadId: THREAD,
            turnId: "t_tui",
            itemId: "m1",
            delta: "Working",
          });
          conn.notify("thread/name/updated", { threadId: THREAD, threadName: "Fix the tests" });
          // Another thread on the shared server is ignored.
          conn.notify("turn/started", { threadId: "thr_other", turn: turn("t_other") });
        };

      return handler(request, conn);
    };

    const { events, server } = await withSession(
      wrapped,
      ({ session, waitFor }) =>
        Effect.gen(function* () {
          sendThreadNotifications?.();
          const delta = yield* waitFor("ItemDelta");
          const started = yield* waitFor("TurnStarted");
          expect(delta).toMatchObject({ itemId: "m1", text: "Working" });
          expect(delta.turnId).toBe(started.turnId);
          yield* waitFor("TitleSuggested");

          // Sending a Turn while one is in flight is refused; steering is the way in.
          const busy = yield* Effect.flip(
            session.sendTurn({ turnId: TurnId.make("x"), prompt: "no", attachments: [] })
          );

          expect(busy.message).toContain("already in progress");
          yield* session.steer("also run lint");
          yield* waitFor("TurnEnded");
          expect(yield* session.terminalCommand).toEqual([
            "/opt/codex/bin/codex",
            "resume",
            THREAD,
            "--remote",
            expect.stringMatching(/^unix:\/\/\/tmp\/pcx-.*\/s\.sock$/),
          ]);
        }),
      { resumeCursor: THREAD, permissionMode: "auto" }
    );

    expect(server.requests("thread/resume")[0]?.params).toMatchObject({
      threadId: THREAD,
      excludeTurns: true,
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
    });
    expect(server.requests("thread/start")).toEqual([]);
    expect(server.requests("turn/steer")[0]?.params).toMatchObject({
      threadId: THREAD,
      expectedTurnId: "t_tui",
      input: [{ type: "text", text: "also run lint" }],
    });
    expect(events[0]).toEqual(HarnessEvent.CursorAssigned({ cursor: THREAD }));
    expect(ofTag(events, "TurnStarted")).toHaveLength(1);
    expect(ofTag(events, "TitleSuggested")).toEqual([
      HarnessEvent.TitleSuggested({ title: "Fix the tests" }),
    ]);
  });

  test("a Turn typed in the TUI carries its prompt; commands and the plan show live", async () => {
    const command = (status: string, output: string | null) => ({
      type: "commandExecution",
      id: "c1",
      command: "bun test",
      cwd: "/repo",
      status,
      aggregatedOutput: output,
      exitCode: status === "completed" ? 0 : null,
    });

    let tui: (() => void) | null = null;

    const handler: Handler = (request, conn) => {
      if (request.method === "thread/resume")
        tui = () => {
          conn.notify("turn/started", { threadId: THREAD, turn: turn("t_tui") });
          conn.notify("item/started", {
            threadId: THREAD,
            turnId: "t_tui",
            startedAtMs: 0,
            item: {
              type: "userMessage",
              id: "u1",
              clientId: null,
              content: [{ type: "text", text: "fix the tests", text_elements: [] }],
            },
          });
          conn.notify("item/started", {
            threadId: THREAD,
            turnId: "t_tui",
            startedAtMs: 0,
            item: command("inProgress", null),
          });
          conn.notify("turn/plan/updated", {
            threadId: THREAD,
            turnId: "t_tui",
            explanation: null,
            plan: [{ step: "run tests", status: "inProgress" }],
          });
          conn.notify("item/completed", {
            threadId: THREAD,
            turnId: "t_tui",
            completedAtMs: 0,
            item: command("completed", "17 pass"),
          });
          conn.notify("turn/completed", { threadId: THREAD, turn: turn("t_tui", "completed") });
        };

      return scripted(() => {})(request, conn);
    };

    const { events } = await withSession(
      handler,
      ({ waitFor }) =>
        Effect.gen(function* () {
          tui?.();
          yield* waitFor("TurnEnded");
        }),
      { resumeCursor: THREAD }
    );

    const started = ofTag(events, "TurnStarted")[0];
    expect(started).toMatchObject({ prompt: "fix the tests" });
    const turnId = started?.turnId ?? TurnId.make("missing");

    const plan = TurnItem.cases.Plan.make({
      id: "t_tui:plan",
      steps: [{ text: "run tests", status: "in-progress" }],
    });

    const commandItem = (
      output: string,
      exitCode: number | null,
      status: "running" | "completed"
    ) =>
      TurnItem.cases.CommandExecution.make({
        id: "c1",
        command: "bun test",
        cwd: "/repo",
        output,
        exitCode,
        status,
      });

    expect(
      events.filter((e) => !HarnessEvent.$is("CursorAssigned")(e) && !HarnessEvent.$is("Exited")(e))
    ).toEqual([
      HarnessEvent.TurnStarted({ turnId, prompt: "fix the tests" }),
      HarnessEvent.ItemUpdated({ turnId, item: commandItem("", null, "running") }),
      HarnessEvent.ItemUpdated({ turnId, item: plan }),
      HarnessEvent.ItemCompleted({ turnId, item: commandItem("17 pass", 0, "completed") }),
      HarnessEvent.ItemCompleted({ turnId, item: plan }),
      HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }),
    ]);
  });

  test("an async question is answered with a new user message", async () => {
    const handler = scripted((request, conn) => {
      if (request.method !== "turn/start") return;
      const text = decodeTurnInput(request.params).input[0]?.text;
      const id = text === "say hi" ? "t1" : "t2";
      conn.reply({ turn: turn(id) });
      conn.notify("turn/started", { threadId: THREAD, turn: turn(id) });

      if (id === "t1")
        conn.notify("item/completed", {
          threadId: THREAD,
          turnId: "t1",
          completedAtMs: 0,
          item: {
            type: "agentMessage",
            id: "m1",
            text: "Which database?",
            phase: null,
            memoryCitation: null,
            delivery: "async",
            questions: [{ title: "Which database?", options: ["Postgres", "SQLite"] }],
          },
        });
      conn.notify("turn/completed", { threadId: THREAD, turn: turn(id, "completed") });
    });

    const { events, server } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({
          turnId: TurnId.make("turn-1"),
          prompt: "say hi",
          attachments: [],
        });
        const asked = yield* waitFor("ApprovalRequested");
        expect(asked).toMatchObject({
          kind: "question",
          title: "Which database?",
          options: ["Postgres", "SQLite"],
        });
        yield* waitFor("TurnEnded");
        yield* session.respond(
          asked.requestId,
          ApprovalDecision.cases.Answer.make({ text: "SQLite" })
        );
        yield* waitFor("TurnEnded", (e) => e.turnId !== TurnId.make("turn-1"));
      })
    );

    expect(server.requests("turn/start")[1]?.params).toMatchObject({
      threadId: THREAD,
      input: [{ type: "text", text: "SQLite" }],
    });
    expect(ofTag(events, "TurnStarted")).toMatchObject([
      { prompt: "say hi" },
      { prompt: "SQLite" },
    ]);
  });

  test("refuses credential and unsupported server requests, and reports a dropped server", async () => {
    let refusal: Promise<ClientAnswer> = Promise.resolve(null);
    let drop = () => {};

    const handler = scripted((request, conn) => {
      if (request.method !== "turn/start") return;
      conn.reply({ turn: turn("t1") });
      refusal = conn.request("account/chatgptAuthTokens/refresh", { reason: "unauthorized" });
      drop = conn.drop;
    });

    const { events } = await withSession(handler, ({ session, waitFor }) =>
      Effect.gen(function* () {
        yield* session.sendTurn({ turnId: TurnId.make("turn-1"), prompt: "go", attachments: [] });
        expect(yield* Effect.promise(() => refusal)).toMatchObject({ error: { code: -32601 } });
        drop();
        yield* waitFor("Exited");
        const failed = yield* Effect.flip(session.steer("anything"));
        expect(failed._tag).toBe("HarnessError");
      })
    );

    const exited = ofTag(events, "Exited");
    expect(exited).toHaveLength(1);
    expect(exited[0]?.error).toContain("closed the connection");
  });

  test("responding to an unknown request fails", async () => {
    await withSession(
      scripted(() => {}),
      ({ session }) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            session.respond(
              RequestId.make("nope"),
              ApprovalDecision.cases.Deny.make({ reason: null })
            )
          );

          expect(error.harness).toBe("codex");
        })
    );
  });
});

describe("probe", () => {
  test("only runs `codex --version`", async () => {
    const dir = mkdtempSync("/tmp/pcx-");
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const fake = join(dir, "codex");
    const log = join(dir, "argv");
    writeFileSync(fake, `#!/bin/sh\necho "$@" >> "${log}"\necho "codex-cli 9.8.7"\n`);
    chmodSync(fake, 0o755);
    const probe = await Effect.runPromise(probeCodex(fake));
    expect(probe).toEqual({ available: true, version: "9.8.7", detail: fake });
    expect((await Bun.file(log).text()).trim()).toBe("--version");
  });

  test("reports a missing codex", async () => {
    expect(await Effect.runPromise(probeCodex(null))).toMatchObject({ available: false });
    expect(await Effect.runPromise(probeCodex("/nonexistent/codex"))).toMatchObject({
      available: false,
    });
  });
});
