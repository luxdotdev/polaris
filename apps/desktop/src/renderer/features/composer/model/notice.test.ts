import { describe, expect, test } from "bun:test";
import type { InstallFlowView } from "../../../../shared/api.ts";
import { daemonNotice } from "./notice.ts";

const flow = (patch: Partial<InstallFlowView>): InstallFlowView => ({
  step: "idle",
  activity: null,
  offer: null,
  outcome: null,
  problem: null,
  ...patch,
});

const upgrade = () => undefined;

describe("the / menu on a Host whose daemon can't list commands", () => {
  test("says so in words, with one action that upgrades it", () => {
    const notice = daemonNotice("This Mac", null, upgrade);

    expect(notice.message).toBe("Skills need a newer daemon on This Mac");
    expect(notice.action?.label).toBe("Upgrade daemon");
  });

  test("follows the upgrade: running, failed, done", () => {
    expect(daemonNotice("pi", flow({ step: "installing" }), upgrade)).toEqual({
      message: "Upgrading the daemon on pi…",
      action: null,
    });
    expect(
      daemonNotice(
        "pi",
        flow({
          step: "blocked",
          problem: { kind: "ssh", message: "Permission denied", command: null },
        }),
        upgrade
      )
    ).toMatchObject({
      message: "Couldn't upgrade the daemon on pi: Permission denied",
      action: { label: "Try again" },
    });
    expect(
      daemonNotice(
        "pi",
        flow({
          step: "ready",
          outcome: { kind: "upgraded", version: "2", from: "1", notes: [], adminCommand: null },
        }),
        upgrade
      ).action
    ).toBeNull();
  });
});
