import { newTempDir, removeTempDir } from "../../platform/tempDir.testing.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  ApprovalDecision,
  Command,
  SessionId,
  SessionPlacement,
  Starter,
  type SettingValue,
} from "@polaris/protocol";
import { Deferred, Effect, Fiber, Layer, Schema, Stream, type Scope } from "effect";
import { Engine } from "../../engine/Engine.ts";
import { EngineRpcHandlers } from "../../engine/rpc.ts";
import { authorizeSessionActor } from "../../engine/sessionActor.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "../../engine/testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { hostSettings } from "../../settings/index.ts";
import { settingsAccessAt, settingsRpcHandlersAt } from "../../settings/rpc.ts";
import { ClientSettings } from "../../clientSettings/index.ts";
import { startServer } from "../../transport/server.ts";
import { harnessProcesses } from "../../harness/processIdentity.ts";
import { sessionTools } from "../sessions/index.ts";
import { sessionStartRpcHandlers } from "../sessions/startRpc.ts";
import { hostSessionDefaultsAt } from "../sessions/defaults.ts";
import { settingsTool } from "./settings.ts";

const caller = SessionId.make("settings-agent");

const fixture = Effect.gen(function* () {
  const engine = yield* Engine;
  const store = yield* EventStore;
  const relay = yield* ClientSettings;
  const root = newTempDir("s3-", { short: true });
  yield* Effect.addFinalizer(() => Effect.sync(() => removeTempDir(root)));
  const settingsPath = join(root, "host-settings.json");
  yield* engine.dispatch({
    commandId: cid(),
    deviceLabel: "user",
    command: Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }),
  });
  const workspace = [...(yield* store.model).workspaces.values()][0]!;
  yield* engine.dispatch({
    commandId: cid(),
    deviceLabel: "user",
    command: Command.cases.StartSession.make({
      sessionId: caller,
      workspaceId: workspace.id,
      harness: "codex",
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "supervised",
      model: null,
      effort: null,
      attachments: [],
      prompt: "Work",
    }),
  });
  yield* waitFor((model) => model.sessions.get(caller)?.session.state === "working");

  const allow = Effect.gen(function* () {
    const model = yield* waitFor((model) => model.sessions.get(caller)?.pending.size === 1);
    const request = [...model.sessions.get(caller)!.pending.values()][0]!;
    yield* engine.dispatch({
      commandId: cid(),
      deviceLabel: "user",
      command: Command.cases.RespondToApproval.make({
        sessionId: caller,
        requestId: request.id,
        decision: ApprovalDecision.cases.Allow.make({ remember: true, grantScope: "session" }),
      }),
    });

    return request;
  });

  return { engine, store, relay, root, settingsPath, workspace, allow };
});

const run = (
  program: Effect.Effect<void, unknown, Engine | EventStore | ClientSettings | Scope.Scope>
) =>
  Effect.runPromise(
    Effect.scoped(program).pipe(
      Effect.provide(
        Layer.mergeAll(
          engineLayer({
            filename: join(tempDir(), "state.sqlite"),
            fakes: makeFakes(),
            drivers: [makeFakeDriver("codex")],
          }),
          ClientSettings.layer
        )
      )
    )
  );

const clientValues: ReadonlyArray<SettingValue> = [
  {
    key: "theme",
    description: "Theme",
    type: { type: "string" },
    default: "system",
    value: "system",
    overridden: false,
    userOnly: false,
  },
  {
    key: "predictionClientEndpoints",
    description: "Endpoints",
    type: { type: "array" },
    default: [],
    value: [],
    overridden: false,
    userOnly: true,
  },
];

test(
  "agent settings discovery and writes use the Grant Approval; userOnly is never grantable",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const ready = yield* Deferred.make<void>();
        yield* Effect.forkChild(
          f.relay
            .connect(1, { settings: clientValues, sessionId: caller, active: true })
            .pipe(
              Stream.runForEach((request) =>
                request === null ? Effect.asVoid(Deferred.succeed(ready, undefined)) : Effect.void
              )
            )
        );
        yield* Deferred.await(ready);
        const access = yield* settingsAccessAt(() => f.settingsPath);
        const tool = settingsTool(caller, { ...sessionTools(f.store), settings: access });
        expect(
          (yield* Effect.promise(() => tool.call({ verb: "list", key: "visuals.level" }))).isError
        ).toBe(true);
        expect(
          (yield* Effect.promise(() => tool.call({ verb: "set", key: "visuals.level" }))).isError
        ).toBe(true);
        const list = yield* Effect.promise(() => tool.call({ verb: "list" }));
        expect(list.content.map((item) => item.text).join("\n")).toContain('"scope":"client"');

        const describe = yield* Effect.promise(() =>
          tool.call({ verb: "describe", key: "visuals.level" })
        );

        expect(describe.content.map((item) => item.text).join("\n")).toContain('"default":"rich"');

        const pending = yield* Effect.forkChild(
          Effect.promise(() => tool.call({ verb: "set", key: "visuals.level", value: "off" }))
        );

        yield* waitFor((model) => model.sessions.get(caller)?.pending.size === 1);
        expect(hostSettings(f.settingsPath).get("visuals.level").value).toBe("rich");
        expect((yield* f.allow).grant?.kind).toBe("settings");
        const result = yield* Fiber.join(pending);
        expect(result.isError).not.toBe(true);
        expect(hostSettings(f.settingsPath).get("visuals.level").value).toBe("off");

        for (const input of [
          { key: "traces.workspaces", value: {}, scope: "host" },
          { key: "sessions.startLimit", value: 20, scope: "host" },
          { key: "predictionClientEndpoints", value: [], scope: "client" },
        ]) {
          const refused = yield* Effect.promise(() => tool.call({ verb: "set", ...input }));
          expect(refused.isError).toBe(true);
          expect(refused.content.map((item) => item.text).join("\n")).toContain("NotGranted");
          expect(refused.content.map((item) => item.text).join("\n")).toContain("Only the user");
        }

        expect((yield* f.store.model).sessions.get(caller)?.pending.size).toBe(0);
        expect(hostSettings(f.settingsPath).get("traces.workspaces").overridden).toBe(false);
        expect(yield* f.engine.sessionStartLimit).toBe(5);
      })
    ),
  30_000
);

test.skipIf(process.platform === "win32")(
  "generated CLI lists both scopes and stdin start inherits the authenticated Session's Workspace and Harness",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        hostSettings(f.settingsPath).set("sessions.defaults", {
          codex: { permissionMode: "full-access", effort: "high", model: "host-model" },
        });
        const ready = yield* Deferred.make<void>();
        yield* Effect.forkChild(
          f.relay
            .connect(1, { settings: clientValues, sessionId: caller, active: true })
            .pipe(Stream.runForEach(() => Effect.asVoid(Deferred.succeed(ready, undefined))))
        );
        yield* Deferred.await(ready);

        const handlers = Layer.mergeAll(
          EngineRpcHandlers,
          settingsRpcHandlersAt(() => f.settingsPath),
          sessionStartRpcHandlers(hostSessionDefaultsAt(() => f.settingsPath))
        ).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Engine, f.engine),
              Layer.succeed(EventStore, f.store),
              Layer.succeed(ClientSettings, f.relay)
            )
          )
        );

        const server = yield* startServer({
          root: f.root,
          socketPath: join(f.root, "d.sock"),
          lockPath: join(f.root, "d.lock"),
          handlers,
          capabilities: ["session.start"],
          authorizeActor: (actor, request) =>
            authorizeSessionActor(actor, request).pipe(Effect.provideService(Engine, f.engine)),
        });

        const listed = Bun.spawn(
          [
            process.execPath,
            new URL("../../main.ts", import.meta.url).pathname,
            "settings",
            "list",
            "--json",
          ],
          {
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, POLARIS_HOST_SOCKET: server.socketPath },
          }
        );

        const values = Schema.decodeUnknownSync(
          Schema.Array(Schema.Struct({ key: Schema.String, scope: Schema.String }))
        )(JSON.parse(yield* Effect.promise(() => new Response(listed.stdout).text())));

        expect(yield* Effect.promise(() => listed.exited)).toBe(0);
        expect(values).toContainEqual({ key: "visuals.level", scope: "host" });
        expect(values).toContainEqual({ key: "theme", scope: "client" });

        const usage = (args: string[], cwd?: string) =>
          Effect.promise(async () => {
            const process = Bun.spawn(
              [
                Bun.which("bun")!,
                new URL("../../main.ts", import.meta.url).pathname,
                "session",
                "start",
                "User prompt",
                ...args,
              ],
              {
                stdout: "pipe",
                stderr: "pipe",
                cwd: cwd ?? f.root,
                env: { POLARIS_HOST_SOCKET: server.socketPath },
              }
            );

            const stderr = await new Response(process.stderr).text();

            return { code: await process.exited, stderr };
          });

        const outside = yield* usage([]);
        expect(outside.code).toBe(2);
        expect(outside.stderr).toContain("--workspace-id");
        const inside = yield* usage([], f.workspace.path);
        expect(inside.code).toBe(2);
        expect(inside.stderr).toContain("--harness");
        expect(inside.stderr).toContain("Installed Harnesses:");
        const user = yield* usage(["--harness", "codex"], f.workspace.path);
        expect(user.code).toBe(1);
        expect(user.stderr).toContain("UserAccessRequired");

        const cli = Bun.spawn(
          [
            process.execPath,
            new URL("../fixtures/startCli.ts", import.meta.url).pathname,
            server.socketPath,
          ],
          { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env } }
        );

        const unregister = harnessProcesses.register(cli.pid, {
          kind: "agentSession",
          sessionId: caller,
        });

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unregister();

            if (cli.exitCode === null) cli.kill();
          })
        );
        yield* Effect.promise(async () => {
          await cli.stdin.write("go");
          await cli.stdin.end();
        });
        yield* waitFor((model) => model.sessions.get(caller)?.pending.size === 1);
        expect((yield* f.store.model).sessions.size).toBe(1);
        expect((yield* f.allow).grant?.kind).toBe("start");
        const output = yield* Effect.promise(() => new Response(cli.stdout).text());
        const stderr = yield* Effect.promise(() => new Response(cli.stderr).text());
        expect({ code: yield* Effect.promise(() => cli.exited), stderr }).toEqual({
          code: 0,
          stderr: "",
        });

        const receipt = Schema.decodeUnknownSync(Schema.Struct({ sessionId: SessionId }))(
          JSON.parse(output)
        );

        const session = (yield* f.store.model).sessions.get(receipt.sessionId)?.session;
        expect(session).toMatchObject({
          workspaceId: f.workspace.id,
          harness: "codex",
          permissionMode: "full-access",
          effort: "high",
          model: "host-model",
          starter: Starter.cases.AgentSession.make({ sessionId: caller }),
        });
      })
    ),
  30_000
);
