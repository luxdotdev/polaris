/**
 * Real check of Codex's `/compact` and `/review` through the whole Daemon:
 *
 *   POLARIS_E2E_CODEX_SLASH=1 bun --cwd apps/daemon scripts/e2e-codex-slash.ts [trace.jsonl]
 *
 * Starts `polaris serve` with a throwaway POLARIS_HOME and a temp git repo, then
 * runs four Turns on Codex's cheapest Model at low effort: "reply with ok",
 * `/compact`, `/review` of an uncommitted one-line change, and one more. Each must end
 * `completed`. With a path, every JSON-RPC frame is traced there (fixtures).
 * Four small Turns are billed to the user's Codex sign-in.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type HostTarget, makeHostConnection, spawnTransport } from "@polaris/client";
import {
  Command,
  CommandId,
  HostStreamItem,
  SessionId,
  SessionPlacement,
  SessionStreamItem,
  TurnItem,
} from "@polaris/protocol";
import { Data, Effect, Option, Stream } from "effect";
import { defaultStateFile, stopAppServer } from "../src/harness/codex/AppServer.ts";

if (process.env.POLARIS_E2E_CODEX_SLASH !== "1") {
  console.log("Set POLARIS_E2E_CODEX_SLASH=1 to run four real Codex Turns.");
  process.exit(0);
}

const MODEL = "gpt-6-luna";

const { Ssh } = Data.taggedEnum<HostTarget>();

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

const home = mkdtempSync("/tmp/pla-");

const repo = mkdtempSync("/tmp/plr-");

const trace = process.argv[2];

const env = { ...process.env, POLARIS_HOME: home, POLARIS_CODEX_TRACE: trace ?? "" };

writeFileSync(join(repo, "greet.txt"), "hello\n");

Bun.spawnSync(["git", "init", "-q"], { cwd: repo });

Bun.spawnSync(["git", "add", "."], { cwd: repo });

Bun.spawnSync(["git", "-c", "user.name=e2e", "-c", "user.email=e2e@x", "commit", "-qm", "init"], {
  cwd: repo,
});

const daemon = spawn("bun", [MAIN, "serve", "--foreground"], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});

const log = (...a: unknown[]) => console.log("[codex-slash]", ...a);

const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`check failed: ${what}`);
  log("✓", what);
};

const sessionId = SessionId.make("codex-slash");

const program = Effect.gen(function* () {
  yield* Effect.sleep("1 second");

  const s = yield* Effect.flatMap(
    makeHostConnection({
      key: "e2e",
      name: "e2e",
      target: Ssh({ alias: "unused" }),
      identity: {
        name: "e2e",
        version: "0.0.0",
        deviceLabel: "e2e",
        capabilities: ["session.live-items"],
      },
      connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
    }),
    (conn) => conn.awaitSession
  );

  let n = 0;

  const dispatch = (command: Command) =>
    s.client.dispatch({ commandId: CommandId.make(`slash-${++n}`), command });

  yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: "slash" }));

  const host = yield* s.client
    .subscribeHost({ afterSequence: null })
    .pipe(Stream.filter(HostStreamItem.guards.Snapshot), Stream.runHead);

  if (Option.isNone(host) || !host.value.workspaces[0]) return yield* Effect.die("no workspace");

  const snapshot = s.client
    .subscribeSession({ sessionId, afterSequence: null, turnLimit: null })
    .pipe(Stream.filter(SessionStreamItem.guards.Snapshot), Stream.runHead);

  /** Waits for the `index`th Turn to leave Working; logs its items. */
  const ended = (index: number, label: string) =>
    Effect.gen(function* () {
      const started = Date.now();

      while (Date.now() - started < 180_000) {
        const snap = Option.getOrUndefined(yield* snapshot);
        const turn = snap?.turns[index];

        if (turn !== undefined && turn.turn.status !== "working") {
          log(
            `${label}: ${turn.turn.status} in ${Date.now() - started} ms, prompt ${JSON.stringify(turn.turn.prompt)}`
          );

          for (const item of turn.items)
            log(`  ${item._tag} ${JSON.stringify(item).slice(0, 160)}`);

          return turn;
        }

        yield* Effect.sleep("1 second");
      }

      return yield* Effect.die(`${label}: still Working after 180 s`);
    });

  yield* dispatch(
    Command.cases.StartSession.make({
      sessionId,
      workspaceId: host.value.workspaces[0].id,
      harness: "codex",
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "supervised",
      model: MODEL,
      effort: "low",
      prompt: "Reply with just the word ok. Do not run commands or edit files.",
      attachments: [],
    })
  );
  const first = yield* ended(0, "ok Turn");
  check(first.turn.status === "completed", "the first Turn completed");

  yield* dispatch(Command.cases.SendTurn.make({ sessionId, prompt: "/compact", attachments: [] }));
  const compact = yield* ended(1, "/compact");
  check(compact.turn.status === "completed", "the /compact Turn completed");

  writeFileSync(join(repo, "greet.txt"), "hello, world\n");
  yield* dispatch(Command.cases.SendTurn.make({ sessionId, prompt: "/review", attachments: [] }));
  const review = yield* ended(2, "/review");
  check(review.turn.status === "completed", "the /review Turn completed");
  check(review.items.some(TurnItem.guards.AssistantMessage), "the review answered with a message");

  // Codex runs a review under a second turn id; the session must be free for the next Turn.
  yield* dispatch(
    Command.cases.SendTurn.make({
      sessionId,
      prompt: "Reply with just the word done.",
      attachments: [],
    })
  );
  const after = yield* ended(3, "after the review");
  check(after.turn.status === "completed", "a Turn after the review completed");
});

await Effect.runPromise(Effect.scoped(program)).then(
  () => log("OK"),
  (e) => {
    log("FAILED", e);
    process.exitCode = 1;
  }
);

daemon.kill("SIGTERM");

await new Promise((r) => daemon.once("exit", r));

await Effect.runPromise(stopAppServer({ stateFile: defaultStateFile(join(home, "codex.sock")) }));

rmSync(home, { recursive: true, force: true });

rmSync(repo, { recursive: true, force: true });
