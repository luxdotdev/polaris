import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  launchDaemon,
  type TestDaemon,
  TEST_USER_KEY,
} from "../../../../packages/sdk/src/daemon.testing.ts";

import { connectRpc, socketTransport } from "@polaris/client";
import {
  Command,
  CommandId,
  SessionId,
  SessionPlacement,
  SessionSummary,
  SessionStreamItem,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect, Redacted, Schema } from "effect";

const sessionId = SessionId.make("ses_cli_test");

let daemon: TestDaemon;

let workspaceId: string;

const cli = async (args: ReadonlyArray<string>, stdin = "") => {
  const child = Bun.spawn(["bun", `${import.meta.dir}/../main.ts`, ...args], {
    env: { ...process.env, POLARIS_HOST_SOCKET: daemon.socketPath },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  await child.stdin.write(stdin);
  await child.stdin.end();

  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { code, out, err };
};

beforeAll(async () => {
  daemon = await launchDaemon();
  workspaceId = await daemon.registerWorkspace();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* socketTransport(daemon.socketPath);
        const { client } = yield* connectRpc(transport);
        yield* client.hello({
          clientName: "test",
          clientVersion: "0",
          deviceLabel: "CLI test",
          capabilities: [],
          userKey: Redacted.make(TEST_USER_KEY),
        });
        yield* client.dispatch({
          commandId: CommandId.make(crypto.randomUUID()),
          command: Command.cases.StartSession.make({
            sessionId,
            workspaceId: Schema.decodeUnknownSync(WorkspaceId)(workspaceId),
            harness: "claude",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: 'bench:{"items":1,"deltaIntervalMs":0}',
            attachments: [],
          }),
        });
      })
    )
  );
}, 60_000);

afterAll(async () => {
  await daemon?.stop();
});

test("generated CLI lists sessions, workspaces, approvals and the local host through the Daemon socket", async () => {
  const sessions = await cli(["session", "list", "--json"]);
  expect(sessions.code).toBe(0);
  const listed = Schema.decodeUnknownSync(Schema.Array(SessionSummary))(JSON.parse(sessions.out));
  expect(listed.map((entry) => entry.session.id)).toContain(sessionId);
  const shown = await cli(["session", "show", sessionId]);
  expect(shown.code).toBe(0);
  expect(JSON.parse(shown.out)).toMatchObject({ session: { id: sessionId } });
  const workspaces = await cli(["workspace", "list"]);
  expect(workspaces.code).toBe(0);
  expect(JSON.parse(workspaces.out)).toContainEqual(expect.objectContaining({ id: workspaceId }));
  const approvals = await cli(["approval", "list"]);
  expect(approvals.code).toBe(0);
  expect(JSON.parse(approvals.out)).toEqual([]);
  const host = await cli(["host", "list"]);
  expect(host.code).toBe(0);
  expect(JSON.parse(host.out)).toContainEqual(expect.objectContaining({ hostId: daemon.hostId }));
}, 30_000);

test("usage, not found, unreachable and refused produce distinct exits; start accepts stdin", async () => {
  expect((await cli(["session", "show"])).code).toBe(2);
  expect((await cli(["session", "show", "ses_missing"])).code).toBe(3);

  const refused = await cli(
    ["session", "start", "--workspace-id", workspaceId, "--harness", "claude"],
    "Review the repository"
  );

  expect(refused.code).toBe(1);
  expect(refused.err).toContain("UserAccessRequired");
  const socket = daemon.socketPath;

  const child = Bun.spawn(["bun", `${import.meta.dir}/../main.ts`, "session", "list"], {
    env: { ...process.env, POLARIS_HOST_SOCKET: `${socket}.absent` },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await child.exited).toBe(4);
}, 30_000);

test("legacy subcommand dispatch still reaches version and existing usage handlers", async () => {
  const version = await cli(["version"]);
  expect(version.code).toBe(0);
  expect(version.out).toContain("polaris");
  const lease = await cli(["lease"]);
  expect(lease.code).toBe(2);
  expect(lease.err).toContain("usage: polaris lease");
  const constellation = await cli(["constellation"]);
  expect(constellation.code).toBe(2);
  expect(constellation.err).toContain("usage: polaris constellation stats");
}, 30_000);

test("watch emits the live session feed as newline-delimited JSON", async () => {
  const child = Bun.spawn(
    ["bun", `${import.meta.dir}/../main.ts`, "session", "watch", sessionId, "--json"],
    {
      env: { ...process.env, POLARIS_HOST_SOCKET: daemon.socketPath },
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const timer = setTimeout(() => child.kill(), 10_000);
  const reader = child.stdout.getReader();
  let text = "";

  try {
    while (!text.includes("\n")) {
      const chunk = await reader.read();

      if (chunk.done) break;

      text += new TextDecoder().decode(chunk.value);
    }

    const snapshot = Schema.decodeUnknownSync(SessionStreamItem.cases.Snapshot)(
      JSON.parse(text.split("\n")[0]!)
    );

    expect(snapshot.session.id).toBe(sessionId);
  } finally {
    clearTimeout(timer);
    child.kill();
    await reader.cancel();
    await child.exited;
  }
}, 15_000);

test("generated settings commands discover Host values and preserve the user-only set gate", async () => {
  const listed = await cli(["settings", "list", "--json"]);
  expect(listed.code).toBe(0);

  const entries = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.Json }))
  )(JSON.parse(listed.out));

  expect(entries.some((entry) => entry.key === "visuals.level")).toBe(true);
  const described = await cli(["settings", "describe", "visuals.level"]);
  expect(described.code).toBe(0);
  const description = Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(described.out));
  expect(description.default).toBe("rich");

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* socketTransport(daemon.socketPath);
        const { client } = yield* connectRpc(transport);
        yield* client.hello({
          clientName: "test",
          clientVersion: "0",
          deviceLabel: "Settings test",
          capabilities: [],
          userKey: Redacted.make(TEST_USER_KEY),
        });
        yield* client["settings.set"]({ key: "visuals.level", value: "off" });
      })
    )
  );
  const value = await cli(["settings", "get", "visuals.level"]);
  expect(value.code).toBe(0);
  expect(
    Schema.decodeUnknownSync(Schema.Struct({ value: Schema.Json }))(JSON.parse(value.out)).value
  ).toBe("off");
  const refused = await cli(["settings", "set", "visuals.level", '"simple"']);
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("UserAccessRequired");
  expect((await cli(["settings", "get", "unknown.setting"])).code).toBe(3);
}, 30_000);
