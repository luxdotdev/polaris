import { describe, expect, test } from "bun:test";
import type { ConnectionStatusView, MachineView } from "../../../../shared/api.ts";
import { HostId } from "@polaris/protocol";
import { pageLine, pill } from "./state.ts";

const NOW = 1_800_000_000_000;

const status = (patch: Partial<ConnectionStatusView>): ConnectionStatusView => ({
  state: "connected",
  failure: null,
  attempt: 0,
  since: NOW,
  nextAttemptAt: null,
  host: null,
  capabilities: [],
  epoch: 1,
  latencyMs: 47,
  lastSeenAt: null,
  ...patch,
});

const machine = (patch: Partial<ConnectionStatusView> = {}): MachineView => ({
  daemon: null,
  key: "studio",
  kind: "ssh",
  label: "Mac Studio",
  colour: "#8FB0E8",
  alias: "lucas-mac-studio",
  target: null,
  enabled: true,
  forwardAgent: false,
  remoteCommand: null,
  status: status(patch),
  install: null,
});

describe("the Connection State pill", () => {
  test("Retry now is hidden on a connected host", () => {
    expect(pill(machine(), NOW)).toEqual({
      state: "connected",
      label: "Connected · 47 ms",
      retry: false,
    });
  });

  test("Retry now shows while Reconnecting or Offline", () => {
    expect(pill(machine({ state: "reconnecting", since: NOW - 12_000 }), NOW)).toEqual({
      state: "reconnecting",
      label: "Reconnecting · 12s",
      retry: true,
    });
    expect(pill(machine({ state: "offline", lastSeenAt: NOW - 2 * 3_600_000 }), NOW)).toMatchObject(
      { label: "Offline · last seen 2h ago", retry: true }
    );
  });

  test("Retry now is hidden while a restart is already reconnecting the host", () => {
    expect(
      pill(machine({ state: "reconnecting", since: NOW - 4_000 }), NOW, "restarting")
    ).toMatchObject({ label: "Reconnecting · 4s", retry: false });
  });

  test("a failed restart reads Needs attention, with Retry now", () => {
    expect(pill(machine(), NOW, "failed")).toEqual({
      state: "needs-attention",
      label: "Needs attention",
      retry: true,
    });
  });
});

test("the header's line has the alias, platform, workspaces and daemon version", () => {
  const view = machine({
    host: {
      hostId: HostId.make("h"),
      hostname: "studio",
      platform: "darwin-arm64",
      daemonVersion: "0.5.0",
      homeDir: "/Users/lucas",
      startedAt: "2026-10-30T00:00:00.000Z",
    },
  });

  expect(pageLine(view, 4, "0.5.0")).toBe(
    "ssh lucas-mac-studio · macOS arm64 · 4 workspaces · daemon 0.5.0"
  );
});
