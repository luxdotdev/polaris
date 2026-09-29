/**
 * Real check of Subagents (ENG-204), driven like a Client:
 *
 *   bun --cwd apps/daemon scripts/e2e-subagents.ts [claude|codex]
 *
 * Starts `polaris serve` with a throwaway POLARIS_HOME and runs one tiny Turn
 * that spawns one Subagent. A Client that announced `session.subagents` must
 * see it under its Turn with its own items; one that didn't must see neither.
 * One tiny Turn (and its Subagent) is billed to the Harness's sign-in.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type HostTarget, makeHostConnection, spawnTransport } from "@polaris/client";
import {
  type Capability,
  Command,
  CommandId,
  HarnessKind,
  HostStreamItem,
  SessionId,
  SessionPlacement,
  SessionStreamItem,
} from "@polaris/protocol";
import { Data, Effect, Option, Schema, Stream } from "effect";
import { defaultStateFile, stopAppServer } from "../src/harness/codex/AppServer.ts";

const harness = Schema.decodeUnknownSync(HarnessKind)(process.argv[2] ?? "claude");

const { Ssh } = Data.taggedEnum<HostTarget>();

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

const home = mkdtempSync("/tmp/pla-");

const repo = mkdtempSync("/tmp/plr-");

const env = { ...process.env, POLARIS_HOME: home };

Bun.spawnSync(["git", "init", "-q"], { cwd: repo });

const daemon = spawn("bun", [MAIN, "serve", "--foreground"], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});

const log = (...a: unknown[]) => console.log("[subagents]", ...a);

const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`check failed: ${what}`);
  log("✓", what);
};

const PROMPT = {
  claude:
    "Use the Agent tool exactly once, with run_in_background set to false, to spawn a " +
    "general-purpose subagent whose only job is to reply with the single word pong. " +
    "Do nothing else. Then reply with what it said.",
  codex:
    "Spawn exactly one subagent and ask it to reply with the word pong and nothing else. " +
    "Wait for it, then reply with what it said. Do not run any commands.",
} as const;

const connect = (key: string, capabilities: ReadonlyArray<Capability>) =>
  Effect.flatMap(
    makeHostConnection({
      key,
      name: key,
      target: Ssh({ alias: "unused" }),
      identity: { name: key, version: "0.0.0", deviceLabel: key, capabilities },
      connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
    }),
    (conn) => conn.awaitSession
  );

const program = Effect.gen(function* () {
  yield* Effect.sleep("1 second");
  const s = yield* connect("with-subagents", ["session.subagents", "session.live-items"]);
  const old = yield* connect("without-subagents", []);
  check(s.capabilities.includes("session.subagents"), "the Daemon announces session.subagents");

  yield* s.client.dispatch({
    commandId: CommandId.make("sub-1"),
    command: Command.cases.RegisterWorkspace.make({ path: repo, name: "subagents" }),
  });

  const host = yield* s.client
    .subscribeHost({ afterSequence: null })
    .pipe(Stream.filter(HostStreamItem.guards.Snapshot), Stream.runHead);

  if (Option.isNone(host) || !host.value.workspaces[0]) return yield* Effect.die("no workspace");
  const sessionId = SessionId.make(`subagents-${harness}`);

  const seen: Array<string> = [];
  const oldSeen: Array<string> = [];

  const follow = (client: typeof s.client, into: Array<string>) =>
    client.subscribeSession({ sessionId, afterSequence: null, turnLimit: null }).pipe(
      Stream.tap((item: SessionStreamItem) =>
        Effect.sync(() => {
          if (SessionStreamItem.guards.Event(item)) {
            const e = item.envelope.event;
            const sub = "subagentId" in e && e.subagentId !== null ? ` [${e.subagentId}]` : "";
            into.push(`${e._tag}${sub}`);
          } else if (SessionStreamItem.guards.Delta(item) && item.subagentId !== null) {
            into.push("Delta [subagent]");
          }
        })
      ),
      Stream.runDrain,
      Effect.forkDetach
    );

  yield* s.client.dispatch({
    commandId: CommandId.make("sub-2"),
    command: Command.cases.StartSession.make({
      sessionId,
      workspaceId: host.value.workspaces[0].id,
      harness,
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "full-access",
      model: harness === "claude" ? "haiku" : "gpt-6-sol",
      effort: harness === "claude" ? null : "low",
      prompt: PROMPT[harness === "claude" ? "claude" : "codex"],
      attachments: [],
    }),
  });

  yield* Effect.sleep("300 millis");
  yield* follow(s.client, seen);
  yield* follow(old.client, oldSeen);

  // Wait for the Turn to end and every Subagent it spawned to end too.
  const snapshotOf = (client: typeof s.client) =>
    client
      .subscribeSession({ sessionId, afterSequence: null, turnLimit: null })
      .pipe(Stream.filter(SessionStreamItem.guards.Snapshot), Stream.runHead);

  const deadline = Date.now() + 240_000;
  let final = yield* snapshotOf(s.client);

  while (Date.now() < deadline) {
    final = yield* snapshotOf(s.client);
    const turn = Option.getOrUndefined(final)?.turns[0];
    const done = turn?.turn.status !== "working" && turn?.turn.status !== undefined;

    if (done && turn.subagents.every((d) => d.subagent.status !== "working")) break;
    yield* Effect.sleep("2 seconds");
  }

  if (Option.isNone(final)) return yield* Effect.die("no session snapshot");
  const turn = final.value.turns[0]!;
  log(`Turn ${turn.turn.status}; ${turn.items.length} own items; subagents:`);

  for (const d of turn.subagents) {
    const { subagent } = d;
    log(
      `  ${subagent.id}: "${subagent.title}" agent ${subagent.agent} model ${subagent.model} ${subagent.status}`
    );

    for (const item of d.items) log(`    ${item._tag} ${JSON.stringify(item).slice(0, 120)}`);
  }

  log("live, with session.subagents:", seen.join(", "));
  log("live, without:", oldSeen.join(", "));

  check(turn.turn.status === "completed", "the Turn completed");
  check(turn.subagents.length >= 1, "the Turn spawned a Subagent");
  const [first] = turn.subagents;
  check(first!.subagent.status === "completed", "the Subagent completed");
  check(first!.items.length > 0, "the Subagent has its own items");
  const own = new Set(turn.items.map((i) => i.id));
  check(
    first!.items.every((i) => !own.has(i.id)),
    "its items are not the Turn's"
  );
  check(
    seen.includes("SubagentStarted") && seen.includes("SubagentEnded"),
    "its Client saw it start and end"
  );
  check(
    seen.some((t) => t.startsWith("TurnItemCompleted [")),
    "its Client saw its items live"
  );

  const plain = yield* snapshotOf(old.client);
  check(
    Option.isSome(plain) && plain.value.turns[0]!.subagents.length === 0,
    "a Client without session.subagents gets no Subagents in its snapshot"
  );
  check(
    oldSeen.every((t) => !t.startsWith("Subagent") && !t.includes("[")),
    "…and none of their events or items live"
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
