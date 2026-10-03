import { describe, expect, test } from "bun:test";
import type { DaemonUpdateProblem, DaemonUpdateView } from "./contract.ts";
import { overrideChoice, platformLabel, updateLine } from "./model.ts";

const NOW = 1_800_000_000_000;

const daemon = (patch: Partial<DaemonUpdateView> = {}): DaemonUpdateView => ({
  managed: true,
  installedVersion: "0.4.1",
  bundledVersion: "0.5.0",
  updateAvailable: false,
  keepDaemonsUpToDate: true,
  keepUpToDateOverride: null,
  keepUpToDate: true,
  progress: null,
  lastUpdate: null,
  ...patch,
});

const line = (d: DaemonUpdateView | null, connected = true) =>
  updateLine({ label: "pi", alias: "lucas-rpi", connected, daemon: d, now: NOW });

const failed = (problem: DaemonUpdateProblem | null) =>
  line(
    daemon({
      lastUpdate: { at: NOW - 1000, result: "failed", from: "0.4.1", version: null, problem },
    })
  );

const problem = (patch: Partial<DaemonUpdateProblem>): DaemonUpdateProblem => ({
  kind: "failed",
  message: "",
  command: null,
  sshFailure: null,
  ...patch,
});

describe("a host's daemon update line", () => {
  test("says nothing while facts load, for a current daemon, or one Polaris doesn't manage", () => {
    expect(line(null).kind).toBe("none");
    expect(line(daemon()).kind).toBe("none");
    expect(line(daemon({ managed: false, updateAvailable: true })).kind).toBe("none");
  });

  test("offers the update with both versions, and waits for a disconnected host", () => {
    expect(line(daemon({ updateAvailable: true, keepUpToDate: false }))).toEqual({
      kind: "available",
      text: "0.5.0 available · upgrades its daemon only when you ask",
      canUpdate: true,
      caption: null,
    });
    expect(line(daemon({ updateAvailable: true, keepUpToDate: false }), false)).toMatchObject({
      canUpdate: false,
      caption: "Upgrades once pi is connected",
    });
    expect(line(daemon({ updateAvailable: true }), false)).toEqual({
      kind: "note",
      text: "Upgrades to 0.5.0 when it connects",
    });
  });

  test("follows the work: checking, real bytes, switching", () => {
    expect(line(daemon({ progress: { stage: "checking", bytes: 0, total: 0 } }))).toEqual({
      kind: "busy",
      text: "Checking pi",
      fraction: null,
    });
    expect(
      line(daemon({ progress: { stage: "uploading", bytes: 4_200_000, total: 16_800_000 } }))
    ).toEqual({
      kind: "busy",
      text: "Copying polaris 0.5.0 · 4.2 of 16.8 MB",
      fraction: 0.25,
    });
    expect(line(daemon({ progress: { stage: "uploading", bytes: 0, total: 0 } }))).toMatchObject({
      text: "Copying polaris 0.5.0",
      fraction: null,
    });
    expect(line(daemon({ progress: { stage: "switching", bytes: 0, total: 0 } }))).toMatchObject({
      text: "Switching to 0.5.0; agent sessions keep going",
    });
  });

  test("says what it did for a day, then goes quiet", () => {
    const done = (ago: number) =>
      line(
        daemon({
          installedVersion: "0.5.0",
          lastUpdate: {
            at: NOW - ago,
            result: "updated",
            from: "0.4.1",
            version: "0.5.0",
            problem: null,
          },
        })
      );

    expect(done(3 * 60_000)).toEqual({ kind: "updated", text: "Upgraded to 0.5.0 · 3m ago" });
    expect(done(25 * 60 * 60_000).kind).toBe("none");
  });

  test("a failure keeps the old daemon in words and offers one fix", () => {
    const libs = failed(
      problem({
        kind: "host-setup",
        message: "It needs glibc 2.31 or newer.",
        command: "sudo apt install libc6",
      })
    );

    expect(libs).toMatchObject({
      kind: "failed",
      failure: {
        reason: "host-setup",
        title: "pi is missing libraries the daemon needs",
        detail: "sudo apt install libc6",
        actions: [{ action: "retry" }, { action: "copy-command" }],
      },
    });
    expect(libs.kind === "failed" && libs.failure.body).toContain("pi still runs 0.4.1.");
  });

  test("ssh failures say which: host key, refused key, unreachable", () => {
    expect(failed(problem({ kind: "ssh", sshFailure: "host-key" }))).toMatchObject({
      failure: { reason: "host-key", detail: "ssh lucas-rpi" },
    });
    expect(
      failed(
        problem({ kind: "ssh", sshFailure: "auth", message: "Permission denied (publickey)." })
      )
    ).toMatchObject({
      failure: {
        reason: "auth",
        title: "pi refused the key",
        detail: "Permission denied (publickey).",
      },
    });
    expect(failed(problem({ kind: "ssh", sshFailure: "unreachable" }))).toMatchObject({
      failure: { reason: "ssh", actions: [{ action: "retry" }] },
    });
  });

  test("a build this app can't run there has nothing to retry", () => {
    expect(
      failed(problem({ kind: "unsupported", message: "FreeBSD isn't supported." }))
    ).toMatchObject({ failure: { reason: "unsupported", actions: [] } });
    expect(failed(null)).toMatchObject({
      failure: { reason: "failed", title: "Upgrading pi didn't finish" },
    });
  });
});

describe("the per-host override", () => {
  test("null follows the app setting; true and false are the host's own", () => {
    expect(overrideChoice(daemon())).toBe("default");
    expect(overrideChoice(daemon({ keepUpToDateOverride: true }))).toBe("on");
    expect(overrideChoice(daemon({ keepUpToDateOverride: false }))).toBe("off");
    expect(line(daemon({ keepUpToDateOverride: false }))).toEqual({
      kind: "note",
      text: "Upgrades its daemon only when you ask",
    });
  });
});

test("platforms read as people say them", () => {
  expect(platformLabel("darwin-arm64")).toBe("macOS arm64");
  expect(platformLabel("linux-x64")).toBe("Linux x64");
  expect(platformLabel("plan9")).toBe("plan9");
});
