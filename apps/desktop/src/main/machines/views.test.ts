import { describe, expect, test } from "bun:test";
import { HostId, HostInfo } from "@polaris/protocol";
import type { ConnectionStatusView, HostView } from "../../shared/api.ts";
import { initialInstall } from "./installFlow.ts";
import { backgroundCheckKey, machineViews, reportOutcome } from "./views.ts";

const status = (patch: Partial<ConnectionStatusView>): ConnectionStatusView => ({
  state: "connected",
  failure: null,
  attempt: 0,
  since: 100,
  nextAttemptAt: null,
  host: null,
  capabilities: [],
  epoch: 1,
  ...patch,
});

const host = (key: string, patch: Partial<ConnectionStatusView> = {}): HostView => ({
  key,
  label: key,
  colour: null,
  alias: key === "local" ? null : key,
  proofHarness: false,
  status: status(patch),
});

const info = (daemonVersion: string) =>
  new HostInfo({
    hostId: HostId.make("h"),
    hostname: "studio",
    platform: "darwin-arm64",
    daemonVersion,
    homeDir: "/Users/x",
    startedAt: "2026-09-30T00:00:00Z",
  });

const attention = (reason: string, since = 100) =>
  status({
    state: "needs-attention",
    since,
    failure: { kind: "needs-attention", reason, detail: "" },
  });

describe("backgroundCheckKey", () => {
  test("checks once per entry into Needs Attention for an install reason", () => {
    const missing = { ...host("studio"), status: attention("polaris-not-installed") };
    expect(backgroundCheckKey(missing, "0.2.0")).toBe("polaris-not-installed:100");
    const retried = { ...missing, status: { ...missing.status, attempt: 3 } };
    expect(backgroundCheckKey(retried, "0.2.0")).toBe(backgroundCheckKey(missing, "0.2.0"));
    expect(
      backgroundCheckKey({ ...host("studio"), status: attention("protocol-mismatch", 200) }, null)
    ).toBe("protocol-mismatch:200");
  });

  test("never for reasons only the user can fix, nor for the local Host", () => {
    expect(
      backgroundCheckKey({ ...host("studio"), status: attention("host-key-changed") }, "0.2.0")
    ).toBeNull();
    expect(
      backgroundCheckKey({ ...host("studio"), status: attention("auth-failed") }, "0.2.0")
    ).toBeNull();
    expect(
      backgroundCheckKey({ ...host("local"), status: attention("polaris-not-installed") }, "0.2.0")
    ).toBeNull();
  });

  test("a connection to an older Daemon checks for an upgrade, once per connection", () => {
    const older = host("studio", { host: info("0.1.0"), epoch: 4 });
    expect(backgroundCheckKey(older, "0.2.0")).toBe("upgrade:4");
    expect(backgroundCheckKey(older, null)).toBeNull();
    expect(backgroundCheckKey(host("studio", { host: info("0.2.0") }), "0.2.0")).toBeNull();
  });
});

describe("machineViews", () => {
  test("this Mac first, even switched off, then remotes in settings order", () => {
    const views = machineViews({
      settings: {
        local: { enabled: false },
        hosts: [
          { alias: "pi", label: "Raspberry Pi 4" },
          { alias: "studio", forwardAgent: true },
        ],
      },
      hosts: [host("studio")],
      installs: new Map([["pi", { snapshot: initialInstall(), activity: null, offerSize: null }]]),
      aliases: [{ alias: "pi", hostName: "10.0.0.9", user: "pi" }],
    });

    expect(views.map((v) => [v.key, v.label, v.enabled, v.status?.state ?? null])).toEqual([
      ["local", "This Mac", false, null],
      ["pi", "Raspberry Pi 4", true, null],
      ["studio", "studio", true, "connected"],
    ]);
    expect(views[1]?.target).toEqual({ hostName: "10.0.0.9", user: "pi" });
    expect(views[1]?.install?.step).toBe("idle");
    expect(views[2]?.forwardAgent).toBe(true);
    expect(views[2]?.install).toBeNull();
  });
});

describe("reportOutcome", () => {
  test("keeps the notes and finds linger's admin command", () => {
    const outcome = reportOutcome(
      {
        ok: true,
        linger: "needs-admin",
        notes: ["Lingering is off. An administrator can run: sudo loginctl enable-linger pi"],
      },
      { kind: "installed", version: "0.2.0", from: null }
    );

    expect(outcome.adminCommand).toBe("sudo loginctl enable-linger pi");
    expect(outcome.notes).toHaveLength(1);
    expect(
      reportOutcome({ ok: true }, { kind: "installed", version: "0.2.0", from: null })
    ).toEqual({
      kind: "installed",
      version: "0.2.0",
      from: null,
      notes: [],
      adminCommand: null,
    });
  });
});
