/**
 * Real check of Model listing and switching (ENG-202), driven like a Client:
 *
 *   bun --cwd apps/daemon scripts/e2e-models.ts [claude|codex]
 *
 * Starts `polaris serve` with a throwaway POLARIS_HOME, asks `harness.models`
 * twice (the second answer must come from the cache), runs one tiny Turn,
 * sends `SetModel`, runs a second tiny Turn, and checks that each Turn records
 * its Model and effort and that the Harness's own log shows the second Model.
 * Two tiny Turns are billed to the Harness's sign-in.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type HostTarget, makeHostConnection, spawnTransport } from "@polaris/client";
import {
  Command,
  CommandId,
  DomainEvent,
  HarnessKind,
  HostStreamItem,
  type Model,
  SessionId,
  SessionPlacement,
  SessionStreamItem,
} from "@polaris/protocol";
import { Data, Effect, Option, Schema, Stream } from "effect";
import { defaultStateFile, stopAppServer } from "../src/harness/codex/AppServer.ts";

const harness = Schema.decodeUnknownSync(HarnessKind)(process.argv[2] ?? "codex");

const { Ssh } = Data.taggedEnum<HostTarget>();

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

const home = mkdtempSync("/tmp/plm-");

const repo = mkdtempSync("/tmp/plr-");

const env = { ...process.env, POLARIS_HOME: home };

Bun.spawnSync(["git", "init", "-q"], { cwd: repo });

const daemon = spawn("bun", [MAIN, "serve", "--foreground"], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});

const log = (...a: unknown[]) => console.log("[models]", ...a);

let n = 0;

const cmd = () => CommandId.make(`models-${++n}`);

const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`check failed: ${what}`);
  log("✓", what);
};

/** The two Models to run on: the first and second choice, cheapest first where known. */
const pick = (models: ReadonlyArray<Model>): readonly [Model, Model] => {
  const byId = (id: string) => models.find((m) => m.id === id);
  const first = harness === "claude" ? byId("haiku") : models.find((m) => !m.isDefault);
  const second = harness === "claude" ? byId("sonnet") : models.find((m) => m.isDefault);

  if (!first || !second)
    throw new Error(`no two Models to switch between: ${models.map((m) => m.id).join(", ")}`);

  return [first, second];
};

/** A log row's Model: Claude's assistant `message.model`, Codex's `turn_context` `payload.model`. */
const LoggedRow = Schema.Union([
  Schema.Struct({ message: Schema.Struct({ model: Schema.String }) }),
  Schema.Struct({
    type: Schema.Literal("turn_context"),
    payload: Schema.Struct({ model: Schema.String }),
  }),
]);

const decodeRow = Schema.decodeUnknownOption(Schema.fromJsonString(LoggedRow));

/** The Models the Harness's own log says each assistant response (Claude) or Turn (Codex) used. */
const loggedModels = (cursor: string): ReadonlyArray<string> => {
  const [dir, pattern] =
    harness === "claude"
      ? [join(homedir(), ".claude", "projects"), `*/${cursor}.jsonl`]
      : [join(homedir(), ".codex", "sessions"), `**/rollout-*${cursor}.jsonl`];

  const [file] = [...new Bun.Glob(pattern).scanSync({ cwd: dir, absolute: true })];

  if (file === undefined) return [];

  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) =>
      Option.match(decodeRow(line), {
        onNone: () => [],
        onSome: (row) => {
          const model = "message" in row ? row.message.model : row.payload.model;

          return model === "<synthetic>" ? [] : [model];
        },
      })
    );
};

const program = Effect.gen(function* () {
  yield* Effect.sleep("1 second");

  const conn = yield* makeHostConnection({
    key: "models",
    name: "Models",
    target: Ssh({ alias: "unused" }),
    identity: {
      name: "polaris-e2e-models",
      version: "0.0.0",
      deviceLabel: "Models check",
      capabilities: ["harness.models", "session.set-model"],
    },
    connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
  });

  const s = yield* conn.awaitSession;
  check(s.capabilities.includes("harness.models"), "the Daemon announces harness.models");
  check(s.capabilities.includes("session.set-model"), "the Daemon announces session.set-model");

  const started = performance.now();
  const listed = yield* s.client["harness.models"]({ harness, refresh: false });
  log(`${listed.models.length} Models in ${(performance.now() - started).toFixed(0)} ms:`);

  for (const m of listed.models) {
    log(
      `  ${m.isDefault ? "*" : " "} ${m.id} (${m.name}) efforts [${m.efforts.join(", ")}] default ${m.defaultEffort}`
    );
  }

  check(listed.models.length > 0, "the Harness lists Models");
  check(listed.switchesModel, "the Harness switches Model mid-session");
  const again = yield* s.client["harness.models"]({ harness, refresh: false });
  check(again.fetchedAt === listed.fetchedAt, "the second answer comes from the per-Host cache");

  const [first, second] = pick(listed.models);
  const effort = second.efforts.includes("low") ? "low" : null;
  log(`first Turn on ${first.id}, then SetModel ${second.id} / effort ${effort}`);

  yield* s.client.dispatch({
    commandId: cmd(),
    command: Command.cases.RegisterWorkspace.make({ path: repo, name: "models" }),
  });

  const snapshot = yield* s.client
    .subscribeHost({ afterSequence: null })
    .pipe(Stream.filter(HostStreamItem.guards.Snapshot), Stream.runHead);

  if (Option.isNone(snapshot) || !snapshot.value.workspaces[0])
    return yield* Effect.die("no workspace");
  const sessionId = SessionId.make(`models-${harness}`);

  const settledTurns = (count: number) =>
    s.client.subscribeSession({ sessionId, afterSequence: null, turnLimit: null }).pipe(
      Stream.filter(
        (item: SessionStreamItem) =>
          SessionStreamItem.guards.Event(item) &&
          DomainEvent.guards.TurnEnded(item.envelope.event) &&
          item.envelope.event.turn.index === count - 1
      ),
      Stream.runHead,
      Effect.timeout("3 minutes")
    );

  yield* s.client.dispatch({
    commandId: cmd(),
    command: Command.cases.StartSession.make({
      sessionId,
      workspaceId: snapshot.value.workspaces[0].id,
      harness,
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "full-access",
      model: first.id,
      effort: null,
      prompt: "Reply with the single word ok.",
      attachments: [],
    }),
  });
  yield* settledTurns(1);
  // Let the session go Idle before switching.
  yield* Effect.sleep("500 millis");

  yield* s.client.dispatch({
    commandId: cmd(),
    command: Command.cases.SetModel.make({ sessionId, model: second.id, effort }),
  });
  yield* s.client.dispatch({
    commandId: cmd(),
    command: Command.cases.SendTurn.make({
      sessionId,
      prompt: "Reply with the single word ok.",
      attachments: [],
    }),
  });
  yield* settledTurns(2);

  const final = yield* s.client
    .subscribeSession({ sessionId, afterSequence: null, turnLimit: null })
    .pipe(Stream.filter(SessionStreamItem.guards.Snapshot), Stream.runHead);

  if (Option.isNone(final)) return yield* Effect.die("no session snapshot");
  const turns = final.value.turns.map((t) => t.turn);
  log("turns:", turns.map((t) => `${t.index}: ${t.status} on ${t.model} / ${t.effort}`).join("; "));
  check(turns.length === 2 && turns.every((t) => t.status === "completed"), "both Turns completed");
  check(turns[0]!.model === first.id && turns[0]!.effort === null, `Turn 0 recorded ${first.id}`);
  check(
    turns[1]!.model === second.id && turns[1]!.effort === effort,
    `Turn 1 recorded ${second.id} / ${effort}`
  );
  check(final.value.session.model === second.id, "the session carries the new Model");

  const cursor = final.value.session.harnessCursor;
  const models = cursor === null ? [] : loggedModels(cursor);
  log("the Harness's own log shows:", models.join(", ") || "(nothing found)");
  const resolved = harness === "claude" ? "sonnet" : second.id;
  check(
    models.some((m) => m.includes(resolved)),
    `the Harness ran the second Turn on ${resolved}`
  );
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
