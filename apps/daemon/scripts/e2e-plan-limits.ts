/**
 * Hands-on check of Plan Limits with the real Daemon and the real Harnesses.
 * It runs one tiny Turn on each of your Claude and Codex accounts:
 *
 *   POLARIS_E2E_PLAN_LIMITS=1 bun --cwd apps/daemon scripts/e2e-plan-limits.ts
 *
 * 1. `polaris serve` (throwaway POLARIS_HOME) through `polaris bridge`; the
 *    Daemon must advertise `usage`, and `usage.watch` must send Codex's last
 *    value from its rollout logs before any session runs.
 * 2. A Claude session (`haiku`) and a Codex session each take one Turn; both
 *    Harnesses' five-hour and weekly windows must arrive as `PlanLimitChanged`.
 * 3. While they run, the Daemon process's open files and sockets (`lsof`) and
 *    its children (`ps`) are recorded: no credential file, no TCP socket.
 * 4. The Daemon restarts; `usage.watch` must send the persisted values again.
 *
 * Evidence goes to `POLARIS_E2E_OUT` (default: a temp dir, printed at the end).
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HostTarget, makeHostConnection, spawnTransport } from "@polaris/client";
import {
  Command,
  CommandId,
  HostStreamItem,
  PlanLimit,
  SessionId,
  SessionPlacement,
  UsageStreamItem,
} from "@polaris/protocol";
import { Cause, Data, Effect, Exit, Option, Schema, Stream } from "effect";
import { defaultStateFile, stopAppServer } from "../src/harness/codex/AppServer.ts";

if (process.env.POLARIS_E2E_PLAN_LIMITS !== "1") {
  console.error(
    "Runs a tiny Claude and Codex Turn on your accounts; set POLARIS_E2E_PLAN_LIMITS=1 to run it."
  );
  process.exit(2);
}

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

const home = mkdtempSync("/tmp/ppl-");

const repo = mkdtempSync("/tmp/ppr-");

const out = process.env.POLARIS_E2E_OUT ?? mkdtempSync(join(tmpdir(), "polaris-e2e-plan-limits-"));

mkdirSync(out, { recursive: true });

const env = { ...process.env, POLARIS_HOME: home };

const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd: repo });

sh("git init -q && git config user.email e2e@x && git config user.name e2e");

writeFileSync(join(repo, "README.md"), "hello\n");

sh("git add -A && git commit -qm init");

const t0 = Date.now();

const log = (...a: unknown[]) =>
  console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const results: Array<{ readonly check: string; readonly ok: boolean; readonly detail: string }> =
  [];

const check = (name: string, ok: boolean, detail = "") => {
  results.push({ check: name, ok, detail });
  log(ok ? "PASS" : "FAIL", name, detail);
};

const until = async (what: string, condition: () => boolean, timeoutMs = 120_000) => {
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

const startDaemon = () =>
  spawn("bun", [MAIN, "serve", "--foreground"], { env, stdio: ["ignore", "inherit", "inherit"] });

const stopDaemon = async (daemon: ReturnType<typeof startDaemon>) => {
  daemon.kill("SIGTERM");
  await new Promise((r) => daemon.once("exit", r));
};

let n = 0;

const cmd = () => CommandId.make(`e2e-${++n}`);

const { Ssh } = Data.taggedEnum<HostTarget>();

const describeLimit = (l: PlanLimit) =>
  `${l.harness} ${l.kind}${l.scope ? ` (${l.scope})` : ""}: ${l.usedPercent ?? "?"}% ${l.status}, resets ${l.resetsAt ?? "?"}, plan ${l.plan ?? "?"}, observed ${l.observedAt}`;

const has = (limits: ReadonlyArray<PlanLimit>, harness: string, kind: string) =>
  limits.some((l) => l.harness === harness && l.kind === kind && l.scope === null);

/** Connects a Client and collects every `PlanLimitChanged` into `into`. */
const watch = (into: Array<PlanLimit>) =>
  Effect.gen(function* () {
    const conn = yield* makeHostConnection({
      key: "e2e",
      name: "E2E",
      target: Ssh({ alias: "unused" }),
      identity: {
        name: "polaris-e2e",
        version: "0.0.0",
        deviceLabel: "E2E",
        capabilities: ["usage"],
      },
      connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
    });

    const s = yield* conn.awaitSession;

    yield* s.client["usage.watch"]({}).pipe(
      Stream.runForEach((item) =>
        Effect.sync(() => {
          if (!UsageStreamItem.guards.PlanLimitChanged(item)) return;

          into.push(item.limit);
          log("PlanLimitChanged", describeLimit(item.limit));
        })
      ),
      Effect.forkScoped
    );

    return s;
  });

/** What the Daemon process holds open and runs, while both sessions are live. */
const inspectDaemon = (pid: number) => {
  const files = Bun.spawnSync(["lsof", "-n", "-P", "-p", String(pid)]).stdout.toString();
  const inet = Bun.spawnSync(["lsof", "-n", "-P", "-a", "-p", String(pid), "-i"]).stdout.toString();
  const tree = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,command="]).stdout.toString();

  const children = tree
    .split("\n")
    .filter((line) => line.trim().split(/\s+/)[1] === String(pid))
    .map((line) => line.trim());

  writeFileSync(join(out, "daemon-lsof.txt"), files);
  writeFileSync(join(out, "daemon-lsof-inet.txt"), inet);
  writeFileSync(join(out, "daemon-children.txt"), children.join("\n"));

  const credential = /credentials|auth\.json|keychain|\.claude\.json|cookies/i;
  const openCredentials = files.split("\n").filter((line) => credential.test(line));

  check(
    "the Daemon holds no credential file open",
    openCredentials.length === 0,
    openCredentials.join("; ")
  );

  // The only socket is the loopback listener for Claude's In Terminal hooks (hooks.ts).
  const sockets = inet
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "");

  const outbound = sockets.filter((line) => !/TCP 127\.0\.0\.1:\d+ \(LISTEN\)/.test(line));

  check(
    "the Daemon opens no network connection (it calls no provider API)",
    outbound.length === 0,
    sockets.join("; ")
  );
  check(
    "the Daemon's children are only the Harnesses",
    children.every((c) => /claude|codex|polaris|bun/.test(c) && !/\bsecurity\b/.test(c)),
    children.join(" | ")
  );
};

const firstRun = (daemonPid: number, limits: Array<PlanLimit>) =>
  Effect.gen(function* () {
    yield* Effect.sleep("1 second");
    const s = yield* watch(limits);
    check(
      "the Daemon advertises `usage`",
      s.capabilities.includes("usage"),
      s.capabilities.join(",")
    );

    yield* Effect.promise(() => until("the Codex rollout seed", () => limits.length > 0, 10_000));
    check(
      "before any session: Codex's last value from its own rollout logs",
      limits.some((l) => l.harness === "codex"),
      limits.map(describeLimit).join("; ")
    );

    yield* s.client.dispatch({
      commandId: cmd(),
      command: Command.cases.RegisterWorkspace.make({ path: repo, name: "e2e" }),
    });

    const snapshot = yield* s.client
      .subscribeHost({ afterSequence: null })
      .pipe(Stream.filter(HostStreamItem.guards.Snapshot), Stream.runHead);

    if (Option.isNone(snapshot)) return yield* Effect.die("no snapshot");
    const workspace = snapshot.value.workspaces[0]!;
    const seeded = limits.length;

    for (const [harness, model] of [
      ["claude", "haiku"],
      ["codex", null],
    ] as const)
      yield* s.client.dispatch({
        commandId: cmd(),
        command: Command.cases.StartSession.make({
          sessionId: SessionId.make(`e2e-plan-limits-${harness}`),
          workspaceId: workspace.id,
          harness,
          placement: SessionPlacement.cases.InPlace.make({}),
          permissionMode: "supervised",
          model,
          effort: null,
          prompt: "Reply with just the word: ok",
          attachments: [],
        }),
      });

    startedAt = new Date().toISOString();
    log("started a Claude and a Codex session");

    const fresh = () => limits.slice(seeded);

    yield* Effect.promise(() =>
      until(
        "Claude's limits",
        () => has(fresh(), "claude", "five-hour") && has(fresh(), "claude", "weekly")
      )
    );

    inspectDaemon(daemonPid);
    check("Claude: five-hour window", has(fresh(), "claude", "five-hour"));
    check("Claude: weekly window", has(fresh(), "claude", "weekly"));
    // Give the Turns' rate-limit events time to arrive, then settle.
    yield* Effect.sleep("20 seconds");
  });

const secondRun = (limits: Array<PlanLimit>) =>
  Effect.gen(function* () {
    yield* Effect.sleep("1 second");
    yield* watch(limits);
    yield* Effect.promise(() =>
      until("the persisted values", () => has(limits, "claude", "five-hour"), 10_000)
    );
  });

const first: Array<PlanLimit> = [];

let startedAt = "";

let daemon = startDaemon();

let outcome: Exit.Exit<void, unknown> = await Effect.runPromise(
  Effect.exit(Effect.scoped(Effect.asVoid(firstRun(daemon.pid!, first))))
);

await stopDaemon(daemon);

const persisted = readFileSync(join(home, "plan-limits.json"), "utf8");

writeFileSync(join(out, "plan-limits.json"), persisted);

// An unchanged value only refreshes `observedAt`, so Codex's read shows up here, not as a change.
const persistedLimits = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ limits: Schema.Array(PlanLimit) }))
)(persisted).limits;

const codexRead = persistedLimits.filter(
  (l) => l.harness === "codex" && startedAt !== "" && l.observedAt >= startedAt
);

check(
  "Codex: the app-server's read landed after the session started",
  codexRead.length > 0,
  codexRead.map(describeLimit).join("; ")
);

check(
  "the persisted file holds only Plan Limits",
  !/token|secret|key|cookie|password/i.test(persisted),
  `${persisted.length} bytes`
);

const second: Array<PlanLimit> = [];

if (Exit.isSuccess(outcome)) {
  daemon = startDaemon();
  outcome = await Effect.runPromise(Effect.exit(Effect.scoped(secondRun(second))));
  await stopDaemon(daemon);
  check(
    "after a restart, the last known values come back with their age",
    has(second, "claude", "five-hour") && has(second, "codex", "weekly"),
    second.map(describeLimit).join("; ")
  );
}

if (Exit.isFailure(outcome)) {
  const error = Cause.pretty(outcome.cause);
  log("ERROR", error);
  results.push({ check: "script ran to the end", ok: false, detail: error });
}

writeFileSync(join(out, "limits.json"), JSON.stringify({ first, second }, null, 2));

writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));

await Effect.runPromise(stopAppServer({ stateFile: defaultStateFile(join(home, "codex.sock")) }));

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
