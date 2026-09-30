/**
 * End-to-end smoke test of the whole Daemon, driven like a Client would:
 *
 *   bun --cwd apps/daemon scripts/smoke.ts [codex|claude|opencode]
 *
 * Starts `polaris serve` with a throwaway POLARIS_HOME, connects through
 * `polaris bridge` (standing in for `ssh <host> polaris bridge`), registers a
 * temp git repo as a Workspace, runs one tiny real Turn with the chosen
 * Harness, then fetches the Turn's diff from its checkpoints.
 *
 * It uses the Harness's own sign-in, so one tiny Turn is billed to it. OpenCode
 * instead runs on its free `opencode/big-pickle` with throwaway XDG directories
 * (no config, no credentials); `POLARIS_SMOKE_MODEL` picks another Model.
 * It also asks `harness.availability` and `harness.models` for the Harness.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type HostTarget, makeHostConnection, spawnTransport } from "@polaris/client";
import {
  Command,
  CommandId,
  DomainEvent,
  GitDiff,
  HarnessKind,
  HostStreamItem,
  SessionId,
  SessionPlacement,
  SessionStreamItem,
  type TurnId,
} from "@polaris/protocol";
import { Data, Effect, Option, Schema, Stream } from "effect";
import { defaultStateFile, stopAppServer } from "../src/harness/codex/AppServer.ts";

const harness = Schema.decodeUnknownSync(HarnessKind)(process.argv[2] ?? "codex");

const { Ssh } = Data.taggedEnum<HostTarget>();

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

const home = mkdtempSync("/tmp/pls-");

const repo = mkdtempSync("/tmp/plr-");

const xdg = (root: string) => ({
  XDG_DATA_HOME: join(root, "data"),
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_STATE_HOME: join(root, "state"),
  XDG_CACHE_HOME: join(root, "cache"),
});

const env = { ...process.env, POLARIS_HOME: home };

if (harness === "opencode") Object.assign(env, xdg(join(home, "xdg")));

const MODELS = new Map([
  ["claude", "haiku"],
  ["opencode", process.env.POLARIS_SMOKE_MODEL ?? "opencode/big-pickle"],
]);

const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd: repo });

sh("git init -q && git config user.email s@x && git config user.name smoke");

writeFileSync(join(repo, "README.md"), "hello\n");

sh("git add -A && git commit -qm init");

const daemon = spawn("bun", [MAIN, "serve", "--foreground"], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});

const log = (...a: unknown[]) => console.log("[smoke]", ...a);

let n = 0;

const cmd = () => CommandId.make(`smoke-${++n}`);

const program = Effect.gen(function* () {
  yield* Effect.sleep("1 second");

  const conn = yield* makeHostConnection({
    key: "smoke",
    name: "Smoke",
    target: Ssh({ alias: "unused" }),
    identity: {
      name: "polaris-smoke",
      version: "0.0.0",
      deviceLabel: "Smoke test",
      capabilities: [],
    },
    connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
  });

  const s = yield* conn.awaitSession;
  log("connected", s.host.hostname, s.host.platform, "capabilities:", s.capabilities.join(", "));

  const availability = yield* s.client["harness.availability"]({ refresh: true });
  const mine = availability.harnesses.find((h) => h.harness === harness);
  log("availability", harness, mine?.status, mine?.version, `min ${mine?.minVersion}`);

  const models = yield* s.client["harness.models"]({ harness, refresh: false });
  log(
    "models",
    harness,
    `${models.models.length} Model(s), switches: ${models.switchesModel}, default:`,
    models.models.find((m) => m.isDefault)?.id ?? "(none)"
  );

  yield* s.client.dispatch({
    commandId: cmd(),
    command: Command.cases.RegisterWorkspace.make({ path: repo, name: "smoke" }),
  });

  const snapshot = yield* s.client
    .subscribeHost({ afterSequence: null })
    .pipe(Stream.filter(HostStreamItem.guards.Snapshot), Stream.runHead);

  if (Option.isNone(snapshot)) return yield* Effect.die("no snapshot");
  const workspace = snapshot.value.workspaces[0];

  if (!workspace) return yield* Effect.die("workspace not registered");
  log("workspace", workspace.id, workspace.path);

  const sessionId = SessionId.make(`smoke-${harness}`);
  yield* s.client.dispatch({
    commandId: cmd(),
    command: Command.cases.StartSession.make({
      sessionId,
      workspaceId: workspace.id,
      harness,
      placement: SessionPlacement.cases.InPlace.make({}),
      permissionMode: "full-access",
      model: MODELS.get(harness) ?? null,
      effort: null,
      prompt:
        "Create a file named ok.txt containing the single word ok, then reply with the word done.",
      attachments: [],
    }),
  });
  log("started", harness, "session");

  let turnId: TurnId | null = null;

  const onEvent = (e: DomainEvent) =>
    DomainEvent.matchOrElse(
      e,
      {
        SessionStateChanged: (changed) => log("state →", changed.state, changed.reason ?? ""),
        TurnStarted: (started) => {
          turnId = started.turn.id;
        },
        TurnItemCompleted: (completed) =>
          log("item", completed.item._tag, JSON.stringify(completed.item).slice(0, 140)),
        CheckpointRecorded: (checkpoint) => log("checkpoint", checkpoint.ref),
        ApprovalRequested: (requested) => log("approval!", requested.request.title),
      },
      () => undefined
    );

  const settled = (item: SessionStreamItem) =>
    SessionStreamItem.guards.Event(item) &&
    DomainEvent.guards.SessionStateChanged(item.envelope.event) &&
    ["idle", "failed", "needs-you"].includes(item.envelope.event.state);

  yield* s.client.subscribeSession({ sessionId, afterSequence: null, turnLimit: null }).pipe(
    Stream.tap((item: SessionStreamItem) =>
      Effect.sync(() => {
        if (SessionStreamItem.guards.Snapshot(item)) {
          log("snapshot: session", item.session.state, `${item.turns.length} turn(s)`);
          turnId = item.turns.at(-1)?.turn.id ?? turnId;
        }

        if (SessionStreamItem.guards.Event(item)) onEvent(item.envelope.event);
      })
    ),
    Stream.takeUntil(settled),
    Stream.runDrain,
    Effect.timeout("3 minutes")
  );

  if (turnId) {
    const diff = yield* s.client["git.diff"]({
      cwd: repo,
      spec: GitDiff.payloadSchema.fields.spec.cases.Turn.make({ sessionId, turnId }),
    });

    const bytes = yield* s.blobs.take(diff.blobId);
    log(`turn diff: ${diff.files} file(s), ${diff.size} bytes`);
    console.log(new TextDecoder().decode(bytes));
  }

  const status = yield* s.client["git.status"]({ cwd: repo });
  log("git status entries:", status.entries.map((e) => e.path).join(", ") || "(clean)");
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

// The shared Codex app-server outlives its Daemon by design; stop this throwaway one.
await Effect.runPromise(stopAppServer({ stateFile: defaultStateFile(join(home, "codex.sock")) }));

rmSync(home, { recursive: true, force: true });

rmSync(repo, { recursive: true, force: true });
