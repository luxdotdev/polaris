/** Hosts for the Settings → Hosts preview: every daemon update state, no real host involved. */
import { Capability, HostId, type Platform } from "@polaris/protocol";
import type { ConnectionStatusView, MachineView } from "../../../../shared/api.ts";
import type { DaemonUpdateView } from "../../../../shared/daemonUpdates.ts";

const MINUTE = 60_000;

const connected = (
  platform: typeof Platform.Type,
  version: string,
  latencyMs: number | null
): ConnectionStatusView => ({
  state: "connected",
  failure: null,
  attempt: 0,
  since: 0,
  nextAttemptAt: null,
  host: {
    hostId: HostId.make(`h-${platform}-${version}`),
    hostname: "host",
    platform,
    daemonVersion: version,
    homeDir: "/home/lucas",
    startedAt: "2026-09-29T00:00:00.000Z",
  },
  capabilities: Capability.literals,
  epoch: 1,
  latencyMs,
  lastSeenAt: null,
});

const offline = (now: number): ConnectionStatusView => ({
  state: "offline",
  failure: null,
  attempt: 3,
  since: now - 40 * MINUTE,
  nextAttemptAt: null,
  host: null,
  capabilities: [],
  epoch: 0,
  latencyMs: null,
  lastSeenAt: now - 3 * 24 * 60 * MINUTE,
});

export const daemon = (patch: Partial<DaemonUpdateView> = {}): DaemonUpdateView => ({
  managed: true,
  installedVersion: "0.4.1",
  bundledVersion: "0.5.0",
  updateAvailable: true,
  keepDaemonsUpToDate: true,
  keepUpToDateOverride: null,
  keepUpToDate: true,
  progress: null,
  lastUpdate: null,
  ...patch,
});

const machine = (
  key: string,
  label: string,
  alias: string | null,
  status: ConnectionStatusView,
  update: DaemonUpdateView
): MachineView => ({
  key,
  label,
  colour: null,
  alias,
  target: alias === null ? null : { hostName: `${alias}.local`, user: "lucas" },
  enabled: true,
  forwardAgent: false,
  remoteCommand: null,
  status,
  install: null,
  daemon: update,
});

export type Scene = "all" | "current" | "failures" | "live";

export const SCENES: ReadonlyArray<Scene> = ["all", "current", "failures", "live"];

const thisMac = (update: DaemonUpdateView) =>
  machine(
    "local",
    "This Mac",
    null,
    connected("darwin-arm64", update.installedVersion ?? "0.5.0", null),
    update
  );

/** Every state at once: offer, checking, real bytes, switching, done, waiting for a host. */
const all = (now: number): ReadonlyArray<MachineView> => [
  machine(
    "pi",
    "Raspberry Pi",
    "lucas-rpi",
    connected("linux-arm64", "0.4.1", 38),
    daemon({
      progress: { stage: "uploading", bytes: 7_340_000, total: 18_600_000 },
    })
  ),
  thisMac(
    daemon({
      installedVersion: "0.5.0",
      updateAvailable: false,
      lastUpdate: {
        at: now - 3 * MINUTE,
        result: "updated",
        from: "0.4.1",
        version: "0.5.0",
        problem: null,
      },
    })
  ),
  machine("studio", "Mac Studio", "studio", connected("darwin-arm64", "0.4.1", 4), daemon()),
  machine(
    "vm",
    "Build VM",
    "build-vm",
    connected("linux-x64", "0.4.1", 61),
    daemon({
      progress: { stage: "switching", bytes: 0, total: 0 },
    })
  ),
  machine(
    "nuc",
    "NUC",
    "nuc",
    connected("linux-x64", "0.4.1", 12),
    daemon({
      keepUpToDateOverride: false,
      keepUpToDate: false,
      progress: { stage: "checking", bytes: 0, total: 0 },
    })
  ),
  machine(
    "laptop",
    "Old laptop",
    "old-laptop",
    offline(now),
    daemon({ installedVersion: "0.3.9" })
  ),
];

const failed = (
  problem: NonNullable<NonNullable<DaemonUpdateView["lastUpdate"]>["problem"]>,
  now: number
) =>
  daemon({
    lastUpdate: { at: now - 2 * MINUTE, result: "failed", from: "0.4.1", version: null, problem },
  });

/** Why an update stopped: missing libraries, ssh host key and auth, a broken copy, no build. */
const failures = (now: number): ReadonlyArray<MachineView> => [
  thisMac(daemon({ installedVersion: "0.5.0", updateAvailable: false })),
  machine(
    "pi",
    "Raspberry Pi",
    "lucas-rpi",
    connected("linux-arm64", "0.4.1", 38),
    failed(
      {
        kind: "host-setup",
        message: "The daemon needs glibc 2.31 or newer; this host has 2.28.",
        command: "sudo apt-get install --only-upgrade libc6",
        sshFailure: null,
      },
      now
    )
  ),
  machine(
    "vm",
    "Build VM",
    "build-vm",
    connected("linux-x64", "0.4.1", 61),
    failed({ kind: "ssh", message: "", command: null, sshFailure: "host-key" }, now)
  ),
  machine(
    "nuc",
    "NUC",
    "nuc",
    connected("linux-x64", "0.4.1", 12),
    failed(
      {
        kind: "ssh",
        message: "lucas@nuc: Permission denied (publickey).",
        command: null,
        sshFailure: "auth",
      },
      now
    )
  ),
  machine(
    "box",
    "Storage box",
    "storage",
    connected("linux-x64", "0.4.1", 90),
    failed(
      {
        kind: "failed",
        message: "SHA-256 didn't match after copying: 9f2c… ≠ 41ab…",
        command: null,
        sshFailure: null,
      },
      now
    )
  ),
];

/** Everything current, the app-wide switch off, one host kept up to date on its own. */
const current = (): ReadonlyArray<MachineView> => [
  thisMac(
    daemon({
      installedVersion: "0.5.0",
      updateAvailable: false,
      keepDaemonsUpToDate: false,
      keepUpToDate: false,
    })
  ),
  machine(
    "studio",
    "Mac Studio",
    "studio",
    connected("darwin-arm64", "0.5.0", 4),
    daemon({
      installedVersion: "0.5.0",
      updateAvailable: false,
      keepDaemonsUpToDate: false,
      keepUpToDateOverride: true,
    })
  ),
  machine(
    "pi",
    "Raspberry Pi",
    "lucas-rpi",
    connected("linux-arm64", "0.5.0", 38),
    daemon({
      installedVersion: "0.5.0",
      updateAvailable: false,
      keepDaemonsUpToDate: false,
      keepUpToDate: false,
    })
  ),
];

/** "live" starts as two offers; Update walks the preview through checking, copying and switching. */
const live = (): ReadonlyArray<MachineView> => [
  thisMac(daemon({ installedVersion: "0.5.0", updateAvailable: false })),
  machine("studio", "Mac Studio", "studio", connected("darwin-arm64", "0.4.1", 4), daemon()),
  machine("pi", "Raspberry Pi", "lucas-rpi", connected("linux-arm64", "0.4.1", 38), daemon()),
];

export const machinesFor = (scene: Scene, now: number): ReadonlyArray<MachineView> => {
  switch (scene) {
    case "current":
      return current();
    case "failures":
      return failures(now);
    case "live":
      return live();
    default:
      return all(now);
  }
};
