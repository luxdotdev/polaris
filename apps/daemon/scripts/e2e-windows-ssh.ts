#!/usr/bin/env bun
/**
 * End to end against a real Windows Host over SSH, the way the Desktop App does it, with the
 * real `@polaris/client` code: probe, a first install of build A into `%USERPROFILE%\.polaris`,
 * a connection through `polaris bridge` (hello, a Workspace, a terminal), an upgrade to build
 * B with the Client reconnecting, then `polaris uninstall`. Prints the evidence.
 *
 *   bun apps/daemon/scripts/e2e-windows-ssh.ts --host <ssh alias> --a <dist dir> --b <dist dir> \
 *     --workspace <C:\dir on the Host> [--keep]
 *
 * Each dist dir is a `scripts/build-daemon.ts windows-x64` output (manifest.json and windows-x64/).
 * The Host must have no Polaris installed; `--keep` leaves build B installed at the end.
 */
import {
  attachTerminal,
  HostTarget,
  makeHostConnection,
  type HostConnection,
} from "@polaris/client";
import {
  applyPlan,
  encodedCommand,
  loadBuilds,
  planInstall,
  probeHost,
  Ssh,
} from "@polaris/client/install";
import { Capability, Command, CommandId, HostStreamItem } from "@polaris/protocol";
import { Effect, Match, Option, Predicate, Stream } from "effect";

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);

  return at >= 0 ? process.argv[at + 1] : undefined;
};

const required = (name: string): string => {
  const value = option(name);

  if (value === undefined) throw new Error(`missing ${name}`);

  return value;
};

const alias = required("--host");

const buildsA = loadBuilds(required("--a"));

const buildsB = loadBuilds(required("--b"));

const workspace = required("--workspace");

const started = Date.now();

/** Evidence printed after a line's label: its JSON. */
type Detail = Parameters<typeof JSON.stringify>[0];

const log = (what: string, detail: Detail = "") =>
  console.log(
    `[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s] ${what}`,
    JSON.stringify(detail)
  );

const check = (what: string, ok: boolean, detail: Detail = "") => {
  log(`${ok ? "ok  " : "FAIL"} ${what}`, detail);

  if (!ok) process.exitCode = 1;
};

const install = Effect.fn("install")(function* (builds: typeof buildsA, label: string) {
  const probe = yield* probeHost(alias);
  log(`probe before ${label}`, probe);
  const build = builds.find((b) => b.platform === "windows-x64")!;

  const plan = planInstall(probe, builds, {
    trigger: "user",
    approvedSha256: new Set([build.sha256]),
  });

  log(`plan ${label}`, { tag: plan._tag, version: build.version, shell: probe.windowsShell });

  const work = Match.value(plan).pipe(
    Match.tags({ Install: (install) => install, Upgrade: (upgrade) => upgrade }),
    Match.orElse(() => null)
  );

  if (work === null) return yield* Effect.die(plan);
  let last = 0;

  const applied = yield* applyPlan(alias, work, {
    progress: (p) => {
      if (p.stage !== "uploading" || p.bytes - last >= 32 * 1024 * 1024 || p.bytes === p.total) {
        last = p.bytes;
        log(`  ${p.stage}`, `${p.bytes}/${p.total}`);
      }
    },
  });

  log(`applied ${label}`, applied);

  return probe;
});

const snapshotOf = (connection: HostConnection) =>
  Effect.gen(function* () {
    const live = yield* connection.awaitSession;

    return yield* live.client
      .subscribeHost({ afterSequence: null })
      .pipe(
        Stream.filter(HostStreamItem.guards.Snapshot),
        Stream.runHead,
        Effect.map(Option.getOrUndefined)
      );
  });

const awaitVersion = (connection: HostConnection, version: string) =>
  connection.changes.pipe(
    Stream.tap((status) =>
      Effect.sync(() =>
        log("  connection", {
          state: status.state,
          epoch: status.epoch,
          failure: status.failure?.reason ?? null,
          detail: status.failure?.detail ?? null,
          version: status.host?.daemonVersion ?? null,
        })
      )
    ),
    Stream.filter((s) => s.state === "connected" && s.host?.daemonVersion === version),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.timeout("90 seconds")
  );

const terminalEcho = (connection: HostConnection) =>
  Effect.scoped(
    Effect.gen(function* () {
      const live = yield* connection.awaitSession;
      const { client } = live;

      const { terminalId } = yield* client["terminal.open"]({
        cwd: workspace,
        cols: 80,
        rows: 24,
        argv: null,
      });

      let text = "";
      yield* attachTerminal(live, terminalId).pipe(
        Stream.runForEach((item) =>
          Effect.sync(() => {
            text += Predicate.isTagged(item, "Output")
              ? new TextDecoder().decode(item.data)
              : `<exit ${item.code}>`;
          })
        ),
        Effect.forkScoped
      );

      yield* client["terminal.input"]({
        terminalId,
        data: new TextEncoder().encode('echo "echo-$(40+2)"\r'),
      });

      const deadline = Date.now() + 20_000;

      while (!/echo-42/.test(text) && Date.now() < deadline) yield* Effect.sleep("50 millis");
      check("terminal echoes over the bridge", /echo-42/.test(text), text.slice(-120));
      yield* client["terminal.close"]({ terminalId });
    })
  );

const program = Effect.gen(function* () {
  const ssh = yield* Ssh;
  const versionA = buildsA[0]!.version;
  const versionB = buildsB[0]!.version;
  log("builds", { a: versionA, b: versionB });

  const probe = yield* install(buildsA, "A");
  check("probe saw Windows", probe.os === "windows" && probe.windowsShell !== undefined, probe);

  const connection = yield* makeHostConnection({
    key: alias,
    name: alias,
    target: HostTarget.Ssh({ alias, windowsShell: probe.windowsShell! }),
    identity: {
      name: "polaris-e2e",
      version: "0.2.0",
      deviceLabel: "e2e",
      capabilities: Capability.literals,
    },
    policy: { initialDelayMs: 200, maxDelayMs: 2000, restartGraceMs: 60_000 },
  });

  const first = yield* awaitVersion(connection, versionA);
  check("hello names windows-x64", first.host?.platform === "windows-x64", first.host);
  log("latency", `${first.latencyMs} ms`);

  const live = yield* connection.awaitSession;
  yield* live.client.dispatch({
    commandId: CommandId.make(`e2e-ws-${Date.now()}`),
    command: Command.cases.RegisterWorkspace.make({ path: workspace, name: "e2e" }),
  });

  const snapshot = yield* snapshotOf(connection);
  check(
    "the Workspace is registered",
    snapshot?.workspaces.some((w) => w.name === "e2e") === true,
    snapshot?.workspaces.map((w) => w.path)
  );
  yield* terminalEcho(connection);

  yield* install(buildsB, "B");
  const second = yield* awaitVersion(connection, versionB);
  check("reconnected to build B", second.epoch > first.epoch, {
    epoch: second.epoch,
    previousStop: second.host?.previousStop ?? null,
  });
  yield* terminalEcho(connection);

  if (process.argv.includes("--keep")) return;

  const uninstall = yield* ssh.exec(
    alias,
    encodedCommand(
      "$exe = Join-Path $env:USERPROFILE '.polaris\\bin\\current\\polaris.exe'; & $exe uninstall --json; exit $LASTEXITCODE"
    )
  );

  log("uninstall", uninstall);
  const after = yield* probeHost(alias);
  check("nothing is installed after uninstall", after.installed === null, after);
});

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(Ssh.layer)));

process.exit();
