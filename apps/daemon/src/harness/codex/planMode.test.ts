/**
 * Polaris's plan mode on Codex, against a fake app-server: the plan collaboration mode on
 * an experimental side connection before each planning Turn, and back to default on leaving.
 */
import { afterEach, expect, test } from "bun:test";
import { TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import { makeCodexDriver } from "./CodexDriver.ts";
import { cleanup, scripted, sessionWith, THREAD, turn } from "./testing/session.ts";

const withSession = sessionWith(makeCodexDriver);

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

let turns = 0;

const handler = scripted((request, conn) => {
  if (request.method === "thread/settings/update") return conn.reply({});

  if (request.method !== "turn/start") return;
  const id = `t${++turns}`;
  conn.reply({ turn: turn(id) });
  conn.notify("turn/started", { threadId: THREAD, turn: turn(id) });
  conn.notify("turn/completed", { threadId: THREAD, turn: turn(id, "completed") });
});

const planned = (mode: "plan" | "default", model: string) => ({
  threadId: THREAD,
  collaborationMode: {
    mode,
    settings: { model, reasoning_effort: null, developer_instructions: null },
  },
});

test("a planning session plans in Codex's plan mode and asks before it edits; leaving it returns to default", async () => {
  const { server } = await withSession(
    handler,
    ({ session, waitFor }) =>
      Effect.gen(function* () {
        const send = (n: number, model: string | null) =>
          session
            .sendTurn({
              turnId: TurnId.make(`turn-${n}`),
              prompt: "hi",
              attachments: [],
              model,
              effort: null,
            })
            .pipe(Effect.andThen(waitFor("TurnEnded", (e) => e.turnId === `turn-${n}`)));

        yield* send(1, "gpt-5");
        yield* session.setPermissionMode("auto-edits");
        yield* send(2, "gpt-5");
        yield* send(3, "gpt-5");
      }),
    { permissionMode: "plan" }
  );

  expect(server.requests("thread/settings/update").map((r) => r.params)).toEqual([
    planned("plan", "gpt-5"),
    planned("default", "gpt-5"),
  ]);
  // The side connection opts into the experimental API; the session's own doesn't.
  expect(server.requests("initialize").map((r) => r.params)).toMatchObject([
    { capabilities: { experimentalApi: false } },
    { capabilities: { experimentalApi: true } },
    { capabilities: { experimentalApi: true } },
  ]);
  expect(server.requests("turn/start")[0]?.params).toMatchObject({
    approvalPolicy: "untrusted",
    sandboxPolicy: { type: "readOnly" },
  });

  // The plan mode is in place before the Turn that plans starts.
  const order = server.received.flatMap((m) =>
    "method" in m && (m.method === "thread/settings/update" || m.method === "turn/start")
      ? [m.method]
      : []
  );

  expect(order.slice(0, 2)).toEqual(["thread/settings/update", "turn/start"]);
});
