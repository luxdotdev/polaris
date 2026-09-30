import { describe, expect, test } from "bun:test";
import type { ConnectionStatusView, InstallFlowView, MachineView } from "../../../shared/api.ts";
import {
  attentionCard,
  connectionLine,
  elapsed,
  hostCaption,
  needsUser,
  offerFacts,
  outcomeNote,
} from "./model.ts";

const status = (patch: Partial<ConnectionStatusView> = {}): ConnectionStatusView => ({
  state: "connected",
  failure: null,
  attempt: 0,
  since: 1_000,
  nextAttemptAt: null,
  host: null,
  capabilities: [],
  epoch: 1,
  ...patch,
});

const install = (patch: Partial<InstallFlowView> = {}): InstallFlowView => ({
  step: "idle",
  activity: null,
  offer: null,
  outcome: null,
  problem: null,
  ...patch,
});

const machine = (patch: Partial<MachineView> = {}): MachineView => ({
  key: "pi",
  label: "Raspberry Pi 4",
  colour: null,
  alias: "pi",
  target: null,
  enabled: true,
  forwardAgent: false,
  remoteCommand: null,
  status: status(),
  install: install(),
  ...patch,
});

const attention = (reason: string, detail = "stderr line") =>
  machine({
    status: status({
      state: "needs-attention",
      failure: { kind: "needs-attention", reason, detail },
    }),
  });

describe("attention cards", () => {
  test("every needs-attention reason gets a card with at most one fix", () => {
    for (const reason of [
      "host-key-unknown",
      "host-key-changed",
      "auth-failed",
      "daemon-not-running",
      "protocol-mismatch",
      "polaris-not-installed",
      "ssh-config-error",
      "ssh-missing",
    ]) {
      const model = attentionCard(attention(reason));
      expect(model?.reason).toBe(reason);
      expect(model?.title.length).toBeGreaterThan(0);
    }
  });

  test("a changed host key never gets a one-click fix", () => {
    const model = attentionCard(attention("host-key-changed"));
    expect(model?.fix).toBeNull();
    expect(model?.detail).toBe("ssh-keygen -R pi");
    expect(model?.secondary?.action).toBe("copy-detail");
  });

  test("an unknown host key hands off to Terminal; auth shows ssh's own line", () => {
    expect(attentionCard(attention("host-key-unknown"))?.fix?.action).toBe("open-ssh");
    expect(
      attentionCard(attention("auth-failed", "pi@10.0.0.9: Permission denied (publickey)."))?.detail
    ).toBe("pi@10.0.0.9: Permission denied (publickey).");
    expect(attentionCard(attention("daemon-not-running"))?.fix?.action).toBe("start-daemon");
  });

  test("the install flow's card wins over the connection's while it runs", () => {
    const installing = {
      ...attention("polaris-not-installed"),
      install: install({ step: "installing", activity: "Copying the build over SSH" }),
    };

    expect(attentionCard(installing)).toMatchObject({
      reason: "installing",
      body: "Copying the build over SSH",
    });

    // The approval card is its own component, not a HostStateCard.
    const approval = {
      ...attention("polaris-not-installed"),
      install: install({ step: "approval" }),
    };

    expect(attentionCard(approval)).toBeNull();
    expect(needsUser(approval)).toBe(true);
  });

  test("problems: host setup, failures, unsupported, and linger's admin command", () => {
    const setup = machine({
      install: install({
        step: "blocked",
        problem: {
          kind: "host-setup",
          message: "The host lacks libstdc++.",
          command: "apk add libstdc++ libgcc",
        },
      }),
    });

    expect(attentionCard(setup)).toMatchObject({
      reason: "host-setup",
      detail: "apk add libstdc++ libgcc",
    });

    const failed = machine({
      install: install({
        step: "blocked",
        problem: { kind: "failed", message: "exit 1", command: null },
      }),
    });

    expect(attentionCard(failed)?.fix).toEqual({ label: "Try again", action: "check" });

    const linger = machine({
      install: install({
        step: "ready",
        outcome: {
          kind: "installed",
          version: "0.2.0",
          from: null,
          notes: [],
          adminCommand: "sudo loginctl enable-linger pi",
        },
      }),
    });

    expect(attentionCard(linger)).toMatchObject({ reason: "linger", fix: null });
    expect(needsUser(machine())).toBe(false);
  });
});

describe("rows", () => {
  test("the Connection column", () => {
    expect(connectionLine(machine({ alias: null }), 0)).toEqual({
      state: "connected",
      label: "Connected",
      caption: "local",
    });
    expect(
      connectionLine(machine({ status: status({ state: "reconnecting", since: 1_000 }) }), 41_000)
    ).toEqual({
      state: "reconnecting",
      label: "Reconnecting",
      caption: "for 40s",
    });
    expect(connectionLine(machine({ status: null }), 0).state).toBe("off");
  });

  test("elapsed time", () => {
    expect([elapsed(12_000), elapsed(245_000), elapsed(3_720_000)]).toEqual([
      "12s",
      "4m 05s",
      "1h 02m",
    ]);
  });

  test("captions and notes", () => {
    expect(hostCaption(machine(), 1)).toBe("ssh pi · 1 workspace");
    expect(hostCaption(machine({ alias: null }), 2)).toBe("This Mac · 2 workspaces");
    expect(hostCaption(machine(), null)).toBe("ssh pi");
    expect(
      outcomeNote(
        machine({
          install: install({
            step: "ready",
            outcome: {
              kind: "upgraded",
              version: "0.2.0",
              from: "0.1.0",
              notes: [],
              adminCommand: null,
            },
          }),
        })
      )
    ).toBe("Daemon upgraded 0.1.0 → 0.2.0");
  });

  test("the approval facts show the whole SHA-256 in two lines", () => {
    const sha = "9f2c41d70be3a6f158c2e9d47a10b3e5c6d82f47e19a0c3b5d7f2e86b4a1e41a";

    const facts = offerFacts(
      machine({
        install: install({
          step: "approval",
          offer: { platform: "linux-arm64", version: "0.1.0", sha256: sha, sizeBytes: 38_200_000 },
        }),
      })
    );

    expect(facts?.map((f) => f.value)).toEqual([
      "linux-arm64",
      "polaris 0.1.0 · 38.2 MB",
      "9f2c41d7 0be3a6f1 58c2e9d4 7a10b3e5\nc6d82f47 e19a0c3b 5d7f2e86 b4a1e41a",
      "~/.polaris on pi",
    ]);
  });
});
