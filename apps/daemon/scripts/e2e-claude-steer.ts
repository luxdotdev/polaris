/**
 * Hands-on check of steering a real Claude Turn through the real Daemon. It
 * runs one small Turn with `haiku` on your Claude account:
 *
 *   POLARIS_E2E_CLAUDE_STEER=1 bun --cwd apps/daemon scripts/e2e-claude-steer.ts
 *
 * The Turn counts to 10 with one `sleep 1; echo N` Bash call per number. Once
 * a couple of numbers are out, Polaris steers "stop at 5". Expected: the Turn
 * stays one Turn, ends once, runs no command after 5 (a call already in
 * flight when the steer lands may finish), and the reply acknowledges it.
 *
 * Evidence goes to `POLARIS_E2E_OUT` (default: a temp dir, printed at the end).
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeHostConnection, spawnTransport } from "@polaris/client";
import { CommandId, SessionId, type SessionStreamItem, type WorkspaceId } from "@polaris/protocol";
import { Effect, Stream } from "effect";

if (process.env.POLARIS_E2E_CLAUDE_STEER !== "1") {
  console.error(
    "Runs a real Claude Turn on your account; set POLARIS_E2E_CLAUDE_STEER=1 to run it."
  );
  process.exit(2);
}

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const home = mkdtempSync("/tmp/pcs-");
const repo = mkdtempSync("/tmp/pcr-");
const out = process.env.POLARIS_E2E_OUT ?? mkdtempSync(join(tmpdir(), "polaris-e2e-claude-steer-"));
mkdirSync(out, { recursive: true });
const env = { ...process.env, POLARIS_HOME: home };

const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd: repo });
sh("git init -q && git config user.email e2e@x && git config user.name e2e");
writeFileSync(join(repo, "README.md"), "hello\n");
sh("git add -A && git commit -qm init");

const daemon = spawn("bun", [MAIN, "serve", "--foreground"], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});
const t0 = Date.now();
const log = (...a: unknown[]) =>
  console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ check: name, ok, ...(detail === undefined ? {} : { detail }) });
  log(ok ? "PASS" : "FAIL", name, detail ?? "");
};
const until = async (what: string, condition: () => boolean, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      log(`timed out waiting for ${what}`);
      return false;
    }
    await Bun.sleep(100);
  }
  return true;
};

let n = 0;
const cmd = () => CommandId.make(`e2e-${++n}`);
const events: Array<{ at: number; event: Record<string, unknown> }> = [];
const eventsOf = (tag: string) => events.filter((e) => e.event._tag === tag);
let state = "unknown";
/** Turns already in the session snapshot (the first one starts before the subscription). */
let snapshotTurns = 0;

/** Numbers echoed by completed Bash calls, in completion order (each call id once). */
const echoed = () => {
  const seen = new Map<string, number>();
  for (const { event } of eventsOf("TurnItemCompleted")) {
    const item = event.item as { _tag: string; id: string; status?: string; output?: string };
    if (item._tag !== "CommandExecution" || item.status !== "completed") continue;
    const number = Number(item.output?.trim().split("\n").at(-1));
    if (Number.isInteger(number)) seen.set(item.id, number);
  }
  return [...seen.values()];
};

const program = Effect.gen(function* () {
  yield* Effect.sleep("1 second");
  const conn = yield* makeHostConnection({
    key: "e2e",
    name: "E2E",
    target: { _tag: "Ssh", alias: "unused" },
    identity: { name: "polaris-e2e", version: "0.0.0", deviceLabel: "E2E", capabilities: [] },
    connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
  });
  const s = yield* conn.awaitSession;
  yield* s.client.dispatch({
    commandId: cmd(),
    command: { _tag: "RegisterWorkspace", path: repo, name: "e2e" },
  });
  const snapshot = yield* s.client.subscribeHost({ afterSequence: null }).pipe(
    Stream.filter((i) => i._tag === "Snapshot"),
    Stream.runHead
  );
  if (snapshot._tag !== "Some" || snapshot.value._tag !== "Snapshot")
    return yield* Effect.die("no snapshot");
  const workspace = snapshot.value.workspaces[0]!;

  const sessionId = SessionId.make("e2e-claude-steer");
  yield* s.client.dispatch({
    commandId: cmd(),
    command: {
      _tag: "StartSession",
      sessionId,
      workspaceId: workspace.id as WorkspaceId,
      harness: "claude",
      placement: { _tag: "InPlace" },
      permissionMode: "full-access",
      model: "haiku",
      prompt: [
        "Count from 1 to 10 slowly using the Bash tool.",
        "For each number N, make a separate Bash call running exactly `sleep 1; echo N`,",
        "one call at a time, waiting for each to finish before the next. Never combine numbers",
        "into one call. After the last number, reply with one short sentence saying where you stopped.",
      ].join(" "),
      attachments: [],
    },
  });
  log("Turn started: count to 10");

  yield* s.client.subscribeSession({ sessionId, afterSequence: null, turnLimit: null }).pipe(
    Stream.runForEach((item: SessionStreamItem) =>
      Effect.sync(() => {
        if (item._tag === "Snapshot") {
          state = item.session.state;
          snapshotTurns = item.turns.length;
          return;
        }
        if (item._tag !== "Event") return;
        const e = item.envelope.event as unknown as Record<string, unknown>;
        events.push({ at: Date.now() - t0, event: e });
        if (e._tag === "SessionStateChanged") {
          state = e.state as string;
          log("state →", state, e.reason ?? "");
        }
        if (e._tag === "TurnStarted" || e._tag === "TurnEnded") {
          const turn = e.turn as { id: string; status: string };
          log(e._tag, turn.id, turn.status);
        }
        if (e._tag === "TurnItemCompleted") log("item", JSON.stringify(e.item).slice(0, 200));
      })
    ),
    Effect.forkScoped
  );

  yield* Effect.promise(() => until("two numbers", () => echoed().length >= 2, 120_000));
  const beforeSteer = echoed();
  log("echoed before the steer:", beforeSteer.join(" "));
  yield* s.client.dispatch({
    commandId: cmd(),
    command: {
      _tag: "Steer",
      sessionId,
      text: "Change of plan: stop at 5. Do not run any command for a number above 5. Once 5 is echoed, reply with one short sentence saying you stopped at 5.",
    },
  });
  const steeredAt = Date.now() - t0;
  log("steered: stop at 5");

  yield* Effect.promise(() => until("Turn end", () => eventsOf("TurnEnded").length > 0, 180_000));
  yield* Effect.sleep("5 seconds"); // anything late would show up here
  const numbers = echoed();
  const ended = eventsOf("TurnEnded");
  const started = eventsOf("TurnStarted");
  log("echoed:", numbers.join(" "));
  const turns = snapshotTurns + started.length;
  check("one Turn in all (the steer made no second Turn)", turns === 1, `${turns}`);
  check("the Turn ended exactly once", ended.length === 1, `${ended.length}`);
  check(
    "it ended completed",
    (ended[0]?.event.turn as { status: string } | undefined)?.status === "completed"
  );
  check("the steer landed mid-Turn", beforeSteer.length < 10 && beforeSteer.length >= 2);
  check(
    "no number above 5 was echoed",
    numbers.every((x) => x <= 5),
    numbers.join(" ")
  );
  check("counting reached 5", numbers.includes(5), numbers.join(" "));
  const replies = eventsOf("TurnItemCompleted")
    .map((e) => e.event.item as { _tag: string; text?: string })
    .filter((item) => item._tag === "AssistantMessage")
    .map((item) => item.text ?? "");
  check("the reply mentions 5", /\b5\b|five/i.test(replies.join(" ")), replies.at(-1));
  check("the session is Idle afterwards", state === "idle", state);
  writeFileSync(
    join(out, "steer.json"),
    JSON.stringify({ steeredAt, beforeSteer, numbers, replies }, null, 2)
  );
});

const outcome = await Effect.runPromise(Effect.scoped(program)).then(
  () => null,
  (e) => e
);
if (outcome !== null) {
  log("ERROR", outcome);
  results.push({ check: "script ran to the end", ok: false, detail: String(outcome) });
}
writeFileSync(join(out, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
daemon.kill("SIGTERM");
await new Promise((r) => daemon.once("exit", r));
rmSync(home, { recursive: true, force: true });
rmSync(repo, { recursive: true, force: true });
log(`evidence in ${out}`);
const failed = results.filter((r) => !r.ok);
log(
  failed.length === 0
    ? "ALL PASS"
    : `${failed.length} FAILED: ${failed.map((f) => f.check).join("; ")}`
);
process.exitCode = failed.length === 0 ? 0 : 1;
