/**
 * `Machines` with a WSL distro as a Host: install commands go through the
 * fake `wsl.exe` (`@polaris/client/wsl/testing`) into a fake distro's HOME,
 * so the real probe, upload and SHA-256 scripts run; the distro list comes
 * from the same fake. Nothing here touches real WSL.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostAccess } from "@polaris/client/access";
import { Ssh } from "@polaris/client/install";
import { discoverDistros, wslInstallLayer } from "@polaris/client/wsl";
import { writeFakeWsl } from "@polaris/client/wsl/testing";
import {
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Predicate,
  Stream,
  SubscriptionRef,
} from "effect";
import type { HostView, MachineView } from "../../shared/api.ts";
import { HostDirectory, type HostEntry, UnknownHost } from "../hosts.ts";
import { LocalHost } from "../local/index.ts";
import type { Settings } from "../settings.ts";
import { openApprovals } from "./approvals.ts";
import { locateBuilds } from "./builds.ts";
import { hostPlatform, writeDist } from "./fakeHost.testing.ts";
import { Machines } from "./service.ts";

const platform = hostPlatform();

let root: string;

let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "polaris-wsl-machines-"));
  home = join(root, "ubuntu");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const setup = () => {
  let settings: Settings = {};
  const dist = join(root, "dist");
  writeDist(dist, { version: "1.2.0", platform });
  const entries = new Map<string, HostEntry>();
  const terminals: Array<ReadonlyArray<string>> = [];
  const hostViews = Effect.runSync(SubscriptionRef.make<ReadonlyArray<HostView>>([]));

  const fake = writeFakeWsl(join(root, "wsl"), {
    distros: [
      { name: "Ubuntu", version: 2, state: "Running", isDefault: true, home },
      { name: "Legacy", version: 1, state: "Stopped", home: join(root, "legacy") },
    ],
  });

  const directory = Layer.succeed(
    HostDirectory,
    HostDirectory.of({
      views: hostViews,
      entry: (key) => entries.get(key),
      connection: (key) => Effect.fail(new UnknownHost(key)),
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
    aliases: () => [],
    openTerminal: (argv) => {
      terminals.push(argv);

      return Promise.resolve();
    },
    discoverWsl: discoverDistros({ ...fake, platform: "win32" }),
  }).pipe(
    Layer.provide(LocalHost.test()),
    Layer.provide(
      HostAccess.fromRunners({
        ssh: Layer.succeed(
          Ssh,
          Ssh.of({ exec: () => Effect.die("ssh must not be used for a WSL Host") })
        ),
        wsl: wslInstallLayer(fake),
        local: () =>
          Layer.succeed(Ssh, Ssh.of({ exec: () => Effect.die("no local Host in this test") })),
      })
    )
  );

  const runtime = ManagedRuntime.make(Layer.provideMerge(machines, directory));

  const ubuntu = (predicate: (view: MachineView) => boolean) =>
    runtime.runPromise(
      Machines.use((m) =>
        SubscriptionRef.changes(m.views).pipe(
          Stream.map((views) => views.find((v) => v.key === "Ubuntu")),
          Stream.filter((view): view is MachineView => view !== undefined && predicate(view)),
          Stream.runHead,
          Effect.map(Option.getOrUndefined),
          Effect.timeout(10_000)
        )
      )
    );

  const call = <A, E>(use: (m: Machines["Service"]) => Effect.Effect<A, E>) =>
    runtime.runPromise(Machines.use(use));

  return { runtime, ubuntu, call, entries, terminals, settings: () => settings };
};

const installed = () => existsSync(join(home, ".polaris", "bin", "current", "polaris"));

describe("a WSL distro as a Host", () => {
  test("lists the distros, with the WSL 1 one unsupported", async () => {
    const t = setup();
    const found = await t.call((m) => m.wslDistros);
    expect(found.status).toBe("distros");
    expect(found.distros.map((d) => [d.name, d.unsupported])).toEqual([
      ["Ubuntu", null],
      ["Legacy", "WSL 1: convert it with wsl --set-version first"],
    ]);
    await t.runtime.dispose();
  });

  test("add → approve → install lands the Daemon in the distro's home", async () => {
    const t = setup();

    const key = await t.call((m) =>
      m.add({ kind: "wsl", alias: "Ubuntu", label: "Ubuntu", colour: null, forwardAgent: false })
    );

    expect(key).toBe("Ubuntu");
    expect(t.settings().hosts?.[0]?.kind).toBe("wsl");
    const entry = t.entries.get("Ubuntu");
    expect(entry !== undefined && Predicate.isTagged(entry.target, "Wsl")).toBe(true);

    const asked = await t.ubuntu((v) => v.install?.step === "approval");
    expect(asked?.kind).toBe("wsl");
    expect(asked?.install?.offer?.platform).toBe(platform);

    await t.call((m) => m.approve("Ubuntu", asked?.install?.offer?.sha256 ?? ""));
    const ready = await t.ubuntu((v) => v.install?.step === "ready");
    expect(ready?.install?.outcome?.kind).toBe("installed");
    expect(installed()).toBe(true);
    await t.runtime.dispose();
  });

  test("approving says it asks the distro, not ssh", async () => {
    const t = setup();
    const activities: Array<string> = [];

    const watcher = t.runtime.runFork(
      Machines.use((m) =>
        SubscriptionRef.changes(m.views).pipe(
          Stream.runForEach((views) =>
            Effect.sync(() => {
              const activity = views.find((v) => v.key === "Ubuntu")?.install?.activity;

              if (activity !== null && activity !== undefined) activities.push(activity);
            })
          )
        )
      )
    );

    await t.call((m) =>
      m.add({ kind: "wsl", alias: "Ubuntu", label: "Ubuntu", colour: null, forwardAgent: false })
    );
    const asked = await t.ubuntu((v) => v.install?.step === "approval");
    activities.length = 0;
    await t.call((m) => m.approve("Ubuntu", asked?.install?.offer?.sha256 ?? ""));
    await t.ubuntu((v) => v.install?.step === "ready");
    expect(activities.length).toBeGreaterThan(0);
    expect(activities.filter((a) => a.includes("SSH"))).toEqual([]);
    await t.runtime.runPromise(Fiber.interrupt(watcher));
    await t.runtime.dispose();
  });

  test("the terminal for a distro Host is a shell in the distro", async () => {
    const t = setup();
    await t.call((m) =>
      m.add({ kind: "wsl", alias: "Ubuntu", label: "Ubuntu", colour: null, forwardAgent: false })
    );
    await t.call((m) => m.openSsh("Ubuntu"));
    expect(t.terminals).toEqual([["wsl.exe", "--distribution", "Ubuntu"]]);
    await t.runtime.dispose();
  });
});
