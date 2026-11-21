import { expect, test } from "bun:test";
import { join } from "node:path";
import { ApprovalDecision, Command, SessionId, SessionPlacement, Starter } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { Engine } from "../engine/Engine.ts";
import { EngineRpcHandlers } from "../engine/rpc.ts";
import { authorizeSessionActor } from "../engine/sessionActor.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "../engine/testing.ts";
import { harnessProcesses } from "../harness/processIdentity.ts";
import { EventStore } from "../store/EventStore.ts";
import { startServer } from "./server.ts";

const program = Effect.scoped(
  Effect.gen(function* () {
    const engine = yield* Engine;
    const store = yield* EventStore;
    const root = tempDir();
    yield* engine.dispatch({
      commandId: cid(),
      deviceLabel: "user",
      command: Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }),
    });
    const workspaceId = [...(yield* store.model).workspaces.keys()][0]!;
    const starter = SessionId.make("cli-starter");
    yield* engine.dispatch({
      commandId: cid(),
      deviceLabel: "user",
      command: Command.cases.StartSession.make({
        sessionId: starter,
        workspaceId,
        harness: "codex",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "full-access",
        model: null,
        effort: null,
        prompt: "Work",
        attachments: [],
      }),
    });
    yield* waitFor((model) => model.sessions.get(starter)?.session.state === "working");

    const server = yield* startServer({
      root,
      socketPath: join(root, "d.sock"),
      lockPath: join(root, "d.lock"),
      handlers: EngineRpcHandlers.pipe(Layer.provide(Layer.succeed(Engine, engine))),
      authorizeActor: (actor, request) =>
        authorizeSessionActor(actor, request).pipe(Effect.provideService(Engine, engine)),
    });

    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "fixtures/grantClient.ts"),
        "harness",
        server.socketPath,
        workspaceId,
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { POLARIS_ACTOR: "user" } }
    );

    const unregister = harnessProcesses.register(child.pid, {
      kind: "agentSession",
      sessionId: starter,
    });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unregister();

        if (child.exitCode === null) child.kill();
      })
    );
    yield* Effect.promise(async () => {
      await child.stdin.write("go");
      await child.stdin.end();
    });
    const model = yield* waitFor((m) => m.sessions.get(starter)?.pending.size === 1);
    expect(model.sessions.has(SessionId.make("from-cli"))).toBe(false);
    const approval = [...model.sessions.get(starter)!.pending.values()][0]!;
    expect(approval.grant?.kind).toBe("start");
    yield* engine.dispatch({
      commandId: cid(),
      deviceLabel: "user",
      command: Command.cases.RespondToApproval.make({
        sessionId: starter,
        requestId: approval.id,
        decision: ApprovalDecision.cases.Allow.make({ remember: false }),
      }),
    });
    const output = yield* Effect.promise(() => new Response(child.stdout).text());
    const stderr = yield* Effect.promise(() => new Response(child.stderr).text());
    expect({
      code: yield* Effect.promise(() => child.exited),
      stderr,
      output: output.trim(),
    }).toEqual({ code: 0, stderr: "", output: "started" });
    expect((yield* store.model).sessions.get(SessionId.make("from-cli"))?.session.starter).toEqual(
      Starter.cases.AgentSession.make({ sessionId: starter })
    );
  })
);

test.skipIf(process.platform === "win32")(
  "a CLI below a Harness waits for that session's Grant Approval and starts once",
  () =>
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
    ),
  30_000
);
