/**
 * Which channel `Machines` acts on for each Host, against `HostAccess.test`: Start daemon
 * and the terminal hand-off per `HostTarget`, with nothing spawned (so it runs on Windows).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installedPaths } from "@polaris/client";
import { HostAccess } from "@polaris/client/access";
import { type SpawnRequest, scriptedChildProcess } from "@polaris/client/process";
import { Effect, Layer, ManagedRuntime, SubscriptionRef } from "effect";
import type { HostView } from "../../shared/api.ts";
import { HostDirectory, type HostEntry } from "../hosts.ts";
import { LocalHost, testDaemon } from "../local/index.ts";
import type { Settings } from "../settings.ts";
import { Machines } from "./service.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polaris-machines-access-"));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const STARTED = '{"ok":true,"action":"install","version":"1.0.0","notes":[]}';

const setup = (localHome: string | null, platform: NodeJS.Platform = "darwin") => {
  const ran: Array<{ readonly target: string; readonly command: string }> = [];
  const terminals: Array<ReadonlyArray<string>> = [];
  const retried: Array<string> = [];
  const listened: Array<string> = [];
  const entries = new Map<string, HostEntry>();
  let settings: Settings = { hosts: [{ alias: "studio" }, { alias: "Ubuntu", kind: "wsl" }] };

  const access = HostAccess.test(
    (target, command) => {
      ran.push({ target: target._tag, command });

      return Effect.succeed({ code: 0, stdout: STARTED, stderr: "" });
    },
    { platform }
  );

  const localHost = LocalHost.test({
    daemon: testDaemon(localHome),
    listening: (h) => Promise.resolve(void listened.push(h)),
  });

  const spawned: Array<SpawnRequest> = [];

  const processes = scriptedChildProcess((request) => {
    spawned.push(request);

    return { exit: { code: 0, stdout: STARTED } };
  });

  const directory = Layer.effect(
    HostDirectory,
    Effect.map(SubscriptionRef.make<ReadonlyArray<HostView>>([]), (views) =>
      HostDirectory.of({
        views,
        entry: (key) => entries.get(key),
        connection: (key) =>
          // SAFETY: the service only calls `retryNow` on the connection here.
          Effect.succeed({ retryNow: Effect.sync(() => void retried.push(key)) } as never),
        add: (entry) => Effect.sync(() => void entries.set(entry.key, entry)),
        remove: (key) => Effect.sync(() => void entries.delete(key)),
      })
    )
  );

  const machines = Machines.layer({
    platform,
    settings: { get: () => settings, update: (change) => void (settings = change(settings)) },
    approvals: { approved: () => new Set(), approve: () => undefined, forget: () => undefined },
    builds: { source: "none", forPlatform: () => Effect.succeed([]) },
    aliases: () => [],
    openTerminal: (argv) => Promise.resolve(void terminals.push(argv)),
    processes,
  });

  const runtime = ManagedRuntime.make(
    Layer.provideMerge(Layer.provide(machines, Layer.mergeAll(access, localHost)), directory)
  );

  const call = <A, E>(use: (m: Machines["Service"]) => Effect.Effect<A, E>) =>
    runtime.runPromise(Machines.use(use));

  const refused = <A, E extends { readonly message: string }>(
    use: (m: Machines["Service"]) => Effect.Effect<A, E>
  ) => runtime.runPromise(Machines.use((m) => Effect.flip(use(m))));

  return { runtime, call, refused, ran, terminals, retried, listened, spawned };
};

const install = (at: string, platform: NodeJS.Platform = "darwin") => {
  const binary = installedPaths(at, platform).binary;
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, "");
};

describe("Machines acts on each Host through its HostAccess channel", () => {
  test("Start daemon on an ssh Host runs polaris install over ssh", async () => {
    const t = setup(null);

    await t.call((m) => m.startDaemon("studio"));
    expect(t.ran.map((r) => r.target)).toEqual(["Ssh"]);
    expect(t.ran[0]?.command).toContain('polaris" install --json');
    expect(t.retried).toEqual(["studio"]);
    await t.runtime.dispose();
  });

  test("Start daemon on a WSL distro runs in the distro, never over ssh", async () => {
    const t = setup(null);

    await t.call((m) => m.startDaemon("Ubuntu"));
    expect(t.ran.map((r) => r.target)).toEqual(["Wsl"]);
    await t.runtime.dispose();
  });

  test("Start daemon on this Mac runs locally and waits for the socket", async () => {
    install(home);
    const t = setup(home);

    await t.call((m) => m.startDaemon("local"));
    expect(t.ran.map((r) => r.target)).toEqual(["Local"]);
    expect(t.listened).toEqual([home]);
    expect(t.retried).toEqual(["local"]);
    await t.runtime.dispose();
  });

  test("this Mac's dev Daemon has no channel: refused, nothing runs anywhere", async () => {
    const t = setup(null);

    for (const use of [
      (m: Machines["Service"]) => m.startDaemon("local"),
      (m: Machines["Service"]) => m.check("local"),
      (m: Machines["Service"]) => m.openSsh("local"),
    ]) {
      const error = await t.refused(use);
      expect(error.message).toContain("not one Polaris installed");
    }

    expect(t.ran).toEqual([]);
    await t.runtime.dispose();
  });

  test("Start daemon on this PC runs its polaris.exe directly, never a shell", async () => {
    install(home, "win32");
    const t = setup(home, "win32");

    await t.call((m) => m.startDaemon("local"));
    expect(t.ran).toEqual([]);
    expect(t.spawned.map((s) => [s.file, ...s.args])).toEqual([
      [installedPaths(home, "win32").binary, "install", "--json"],
    ]);
    expect(t.listened).toEqual([home]);
    await t.runtime.dispose();
  });

  test("the terminal hand-off is ssh for an alias, a shell in a distro, none for this Mac", async () => {
    install(home);
    const t = setup(home);

    await t.call((m) => m.openSsh("studio"));
    await t.call((m) => m.openSsh("Ubuntu"));
    expect(t.terminals).toEqual([
      ["ssh", "--", "studio"],
      ["wsl.exe", "--distribution", "Ubuntu"],
    ]);
    expect((await t.refused((m) => m.openSsh("local"))).message).toContain("no ssh hand-off");
    expect((await t.refused((m) => m.openSsh("gone"))).message).toBe('no remote host "gone"');
    await t.runtime.dispose();
  });
});
