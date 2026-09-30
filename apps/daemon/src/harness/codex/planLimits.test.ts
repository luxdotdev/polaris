import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type PlanLimit, SessionId } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { makeCodexDriver } from "./CodexDriver.ts";
import { type FakeConnection, startFakeAppServer } from "./testing/FakeAppServer.ts";

const realRead = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
  readFileSync(join(import.meta.dir, "../limits/fixtures/codex-rate-limits-read.json"), "utf8")
);

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;

    await Bun.sleep(2);
  }

  throw new Error(`timed out waiting for ${label}`);
};

/** Opens a Codex session on a fake app-server; `connection` is the session's, once it asked. */
const run = async (
  readReply: (conn: FakeConnection) => void,
  body: (h: {
    readonly reported: Array<PlanLimit>;
    readonly connection: () => FakeConnection;
  }) => Promise<void>
) => {
  // Socket paths must stay under ~104 bytes.
  const dir = mkdtempSync("/tmp/pcl-");
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "s.sock");
  let connection: FakeConnection | null = null;

  const server = startFakeAppServer(path, (request, conn) => {
    if (request.method === "initialize") return conn.reply({ userAgent: "fake" });

    if (request.method === "thread/start") return conn.reply({ thread: { id: "thr_1" } });

    if (request.method === "thread/unsubscribe") return conn.reply({ status: "unsubscribed" });

    if (request.method === "account/rateLimits/read") {
      connection = conn;
      readReply(conn);
    }
  });

  cleanup.push(server.stop);
  const reported: Array<PlanLimit> = [];

  const program = Effect.gen(function* () {
    const driver = yield* makeCodexDriver({
      socketPath: path,
      spawnAppServer: false,
      codexPath: "/opt/codex/bin/codex",
      planLimits: { report: (limits) => reported.push(...limits) },
    });

    yield* driver.open({
      sessionId: SessionId.make("s1"),
      cwd: "/repo",
      permissionMode: "supervised",
      model: null,
      effort: null,
      resumeCursor: null,
    });

    yield* Effect.promise(() =>
      body({
        reported,
        connection: () => {
          if (connection === null) throw new Error("no rate-limit read yet");

          return connection;
        },
      })
    );
  });

  await Effect.runPromise(Effect.scoped(program));

  return server;
};

describe("Codex Plan Limits", () => {
  test("reads the account's rate limits when a session connects, then merges updates", async () => {
    const server = await run(
      (conn) => conn.reply(realRead),
      async ({ reported, connection }) => {
        await until(() => reported.length === 1, "the read");

        // Sparse: no plan; the weekly window it leaves out keeps its last value.
        connection().notify("account/rateLimits/updated", {
          rateLimits: {
            limitId: "codex",
            primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 1791098186 },
            secondary: null,
            planType: null,
          },
        });
        await until(() => reported.length === 2, "the update");
      }
    );

    expect(server.requests("account/rateLimits/read")[0]?.params).toEqual({});
    // Nothing account- or credential-related beyond the read itself.
    expect(
      [...new Set(server.received.map((m) => m.method ?? ""))].sort((a, b) => a.localeCompare(b))
    ).toEqual([
      "account/rateLimits/read",
      "initialize",
      "initialized",
      "thread/start",
      "thread/unsubscribe",
    ]);
  });

  test("an update keeps the plan the read named", async () => {
    const seen: Array<PlanLimit> = [];

    await run(
      (conn) => conn.reply(realRead),
      async ({ reported, connection }) => {
        await until(() => reported.length === 1, "the read");
        connection().notify("account/rateLimits/updated", {
          rateLimits: { limitId: "codex", primary: { usedPercent: 9, windowDurationMins: 10080 } },
        });
        await until(() => reported.length === 2, "the update");
        seen.push(...reported);
      }
    );

    expect(seen.map((l) => [l.kind, l.usedPercent, l.plan])).toEqual([
      ["weekly", 7, "prolite"],
      ["weekly", 9, "prolite"],
    ]);
  });

  test("a failed read (not signed in) leaves the session working and reports nothing", async () => {
    const seen: Array<PlanLimit> = [];

    await run(
      (conn) => conn.replyError(-32600, "not signed in"),
      async ({ reported }) => {
        await Bun.sleep(30);
        seen.push(...reported);
      }
    );

    expect(seen).toEqual([]);
  });
});
