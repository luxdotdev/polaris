/**
 * `Machines` end to end against a fake Host: commands "sent over ssh" run in
 * a local `sh` with HOME at a temporary directory, so the real probe, upload
 * and SHA-256 scripts run. The Host list is a stand-in the test drives, to
 * play reconnects.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ssh, SshError } from "@polaris/client/install";
import { HostId, HostInfo } from "@polaris/protocol";
import { Effect, Layer, ManagedRuntime, Option, Stream, SubscriptionRef } from "effect";
import type { ConnectionStatusView, HostView, MachineView } from "../../shared/api.ts";
import { HostDirectory, type HostEntry, UnknownHost } from "../hosts.ts";
import type { Settings } from "../settings.ts";
import { openApprovals } from "./approvals.ts";
import { locateBuilds } from "./builds.ts";
import { hostPlatform, runOnFakeHost, writeDist } from "./fakeHost.testing.ts";
import { Machines } from "./service.ts";

const platform = hostPlatform();

let root: string;

let home: string;

let dist: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "polaris-machines-"));
  home = join(root, "host");
  dist = join(root, "dist");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const status = (patch: Partial<ConnectionStatusView>): ConnectionStatusView => ({
  state: "reconnecting",
  failure: null,
  attempt: 0,
  since: 1,
  nextAttemptAt: null,
  host: null,
  capabilities: [],
  epoch: 0,
  latencyMs: null,
  ...patch,
});

const setup = (sshFails = false) => {
  let settings: Settings = {};
  const hostViews = Effect.runSync(SubscriptionRef.make<ReadonlyArray<HostView>>([]));
  const entries = new Map<string, HostEntry>();
  const retried: Array<string> = [];

  const directory = Layer.succeed(
    HostDirectory,
    HostDirectory.of({
      views: hostViews,
      entry: (key) => entries.get(key),
      connection: (key) =>
        key === "studio"
          ? // SAFETY: the service only calls `retryNow` on the connection here.
            Effect.succeed({ retryNow: Effect.sync(() => void retried.push(key)) } as never)
          : Effect.fail(new UnknownHost(key)),
      add: (entry) => Effect.sync(() => void entries.set(entry.key, entry)),
      remove: (key) => Effect.sync(() => void entries.delete(key)),
    })
  );

  const machines = Machines.layer({
    settings: { get: () => settings, update: (change) => void (settings = change(settings)) },
    approvals: openApprovals(join(root, "approvals.json")),
    builds: locateBuilds({
      env: { POLARIS_DESKTOP_DAEMON_DIST: dist },
      resources: null,
      repoRoot: root,
      buildOnDemand: false,
    }),
    aliases: () => [{ alias: "studio", hostName: "studio.lan", user: null }],
    localDaemon: () => Promise.reject(new Error("unused")),
    openTerminal: () => Promise.resolve(),
    ssh: Layer.succeed(
      Ssh,
      Ssh.of({
        exec: (alias, command, options) =>
          sshFails
            ? Effect.fail(
                new SshError({
                  alias,
                  failure: "host-key",
                  message: "Host key verification failed.",
                })
              )
            : Effect.sync(() => runOnFakeHost(home, command, options?.stdinFile)),
      })
    ),
  });

  const runtime = ManagedRuntime.make(Layer.provideMerge(machines, directory));

  /** Waits until the studio row satisfies `predicate`. */
  const studio = (predicate: (view: MachineView) => boolean) =>
    runtime.runPromise(
      Machines.use((m) =>
        SubscriptionRef.changes(m.views).pipe(
          Stream.map((views) => views.find((v) => v.key === "studio")),
          Stream.filter((view): view is MachineView => view !== undefined && predicate(view)),
          Stream.runHead,
          Effect.map(Option.getOrUndefined),
          Effect.timeout(5000)
        )
      )
    );

  const setStatus = (patch: Partial<ConnectionStatusView>) =>
    runtime.runPromise(
      SubscriptionRef.set(hostViews, [
        {
          key: "studio",
          label: "Mac Studio",
          colour: null,
          alias: "studio",
          proofHarness: false,
          status: status(patch),
        },
      ])
    );

  const call = <A, E>(use: (m: Machines["Service"]) => Effect.Effect<A, E>) =>
    runtime.runPromise(Machines.use(use));

  return { runtime, studio, setStatus, call, retried, settings: () => settings, entries };
};

const installed = () => existsSync(join(home, ".polaris", "bin", "current", "polaris"));

const info = (daemonVersion: string) =>
  new HostInfo({
    hostId: HostId.make("studio"),
    hostname: "studio",
    platform: "darwin-arm64",
    daemonVersion,
    homeDir: home,
    startedAt: "2026-09-30T00:00:00Z",
  });

describe("Machines", () => {
  test("add, approve and install; the approval persists and the Host reconnects", async () => {
    const sha = writeDist(dist, { version: "0.2.0", platform });
    const { runtime, studio, call, retried, settings, entries } = setup();

    await call((m) =>
      m.add({ alias: "studio", label: "Mac Studio", colour: null, forwardAgent: false })
    );
    expect(settings().hosts).toEqual([
      { alias: "studio", forwardAgent: false, label: "Mac Studio" },
    ]);
    expect(entries.get("studio")?.remoteCommand).toBeNull();

    const asked = await studio((v) => v.install?.step === "approval");
    expect(asked?.install?.offer).toMatchObject({ platform, version: "0.2.0", sha256: sha });
    expect(installed()).toBe(false);

    await call((m) => m.approve("studio", sha));
    const done = await studio((v) => v.install?.step === "ready");
    expect(done?.install?.outcome?.kind).toBe("installed");
    expect(installed()).toBe(true);
    expect(retried).toContain("studio");
    expect([...openApprovals(join(root, "approvals.json")).approved("studio")]).toEqual([sha]);
    await runtime.dispose();
  });

  test("a reconnect that finds no Daemon asks again and never installs, even approved", async () => {
    const sha = writeDist(dist, { version: "0.2.0", platform });
    openApprovals(join(root, "approvals.json")).approve("studio", {
      sha256: sha,
      platform,
      version: "0.2.0",
      approvedAt: 1,
    });
    const { runtime, studio, setStatus, call } = setup();
    await call((m) => m.add({ alias: "studio", label: "", colour: null, forwardAgent: false }));
    // The user's own check installs the approved build.
    await studio((v) => v.install?.outcome?.kind === "installed");
    rmSync(join(home, ".polaris"), { recursive: true, force: true });

    await setStatus({
      state: "needs-attention",
      since: 50,
      failure: { kind: "needs-attention", reason: "polaris-not-installed", detail: "" },
    });
    const asked = await studio((v) => v.install?.step === "approval");
    expect(asked?.install?.offer?.sha256).toBe(sha);
    expect(installed()).toBe(false);
    await runtime.dispose();
  });

  test("a connection to an older Daemon upgrades in the background and says so", async () => {
    writeDist(dist, { version: "0.1.0", platform });
    runOnFakeHost(home, `mkdir -p "$HOME" && "${join(dist, platform, "polaris")}" install`);
    writeDist(dist, { version: "0.2.0", platform });
    const { runtime, studio, setStatus, call } = setup();
    await call((m) => m.add({ alias: "studio", label: "", colour: null, forwardAgent: false }));
    await studio((v) => v.install?.step === "ready");

    // An upgrade happens whatever the trigger; make sure this one is the reconnect's.
    runOnFakeHost(home, `ln -sfn 0.1.0 "$HOME/.polaris/bin/current"`);
    await setStatus({ state: "connected", epoch: 7, host: info("0.1.0") });
    const upgraded = await studio((v) => v.install?.outcome?.kind === "upgraded");
    expect(upgraded?.install?.outcome).toMatchObject({ from: "0.1.0", version: "0.2.0" });
    await runtime.dispose();
  });

  test("not now parks the Host; settings changes are kept", async () => {
    writeDist(dist, { version: "0.2.0", platform });
    const { runtime, studio, call, settings } = setup();
    await call((m) => m.add({ alias: "studio", label: "", colour: null, forwardAgent: true }));
    await studio((v) => v.install?.step === "approval");
    await call((m) => m.dismiss("studio"));
    await studio((v) => v.install?.step === "dismissed");

    await call((m) => m.update("studio", { remoteCommand: "  polaris bridge ", label: "Studio" }));
    expect(settings().hosts?.[0]).toMatchObject({
      label: "Studio",
      remoteCommand: "polaris bridge",
    });
    await call((m) => m.update("studio", { remoteCommand: null }));
    expect(settings().hosts?.[0]?.remoteCommand).toBeUndefined();
    expect(settings().hosts?.[0]?.forwardAgent).toBe(true);
    await runtime.dispose();
  });

  test("ssh failing during the check is an ssh problem, not a failed install", async () => {
    writeDist(dist, { version: "0.2.0", platform });
    const { runtime, studio, call } = setup(true);
    await call((m) => m.add({ alias: "studio", label: "", colour: null, forwardAgent: false }));
    const blocked = await studio((v) => v.install?.step === "blocked");
    expect(blocked?.install?.problem).toEqual({
      kind: "ssh",
      message: "Host key verification failed.",
      command: null,
    });
    await runtime.dispose();
  });

  test("remove forgets the Host and its approvals", async () => {
    const sha = writeDist(dist, { version: "0.2.0", platform });
    openApprovals(join(root, "approvals.json")).approve("studio", {
      sha256: sha,
      platform,
      version: "0.2.0",
      approvedAt: 1,
    });
    const { runtime, studio, call, settings } = setup();
    await call((m) => m.add({ alias: "studio", label: "", colour: null, forwardAgent: false }));
    await studio((v) => v.install?.step === "ready");
    await call((m) => m.remove("studio"));
    expect(settings().hosts).toEqual([]);
    expect(openApprovals(join(root, "approvals.json")).approved("studio").size).toBe(0);
    await runtime.dispose();
  });
});
