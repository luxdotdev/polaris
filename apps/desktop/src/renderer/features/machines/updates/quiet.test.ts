import { describe, expect, test } from "bun:test";
import type { DaemonUpdateResult } from "../../../../shared/daemonUpdates.ts";
import {
  stopCaption,
  stopHover,
  UPGRADE_CAPTION_MS,
  upgradeCaption,
  upgradeHover,
} from "./quiet.ts";

const NOW = 1_800_000_000_000;

const last: DaemonUpdateResult = {
  at: NOW,
  result: "updated",
  from: "0.4.0",
  version: "0.5.0",
  problem: null,
};

describe("quiet Daemon Upgrade status", () => {
  test("caption expires after exactly an hour or when the host opens", () => {
    expect(upgradeCaption(last, undefined, NOW + UPGRADE_CAPTION_MS - 1)).toBe("Upgraded to 0.5.0");
    expect(upgradeCaption(last, undefined, NOW + UPGRADE_CAPTION_MS)).toBeNull();
    expect(upgradeCaption(last, NOW, NOW)).toBeNull();
    expect(upgradeCaption(last, NOW - 1, NOW)).toBe("Upgraded to 0.5.0");
  });
  test("opening an old upgrade doesn't suppress a later upgrade", () => {
    expect(upgradeCaption({ ...last, at: NOW + 1000 }, NOW, NOW + 1000)).toBe("Upgraded to 0.5.0");
  });
  test("the hover states both versions and that sessions kept working, for a day", () => {
    expect(upgradeHover(last, NOW + 180_000)).toEqual({
      title: "Daemon upgraded to 0.5.0 · 3m ago",
      body: "From 0.4.0, to match this Mac. Agent sessions kept working.",
    });
    expect(upgradeHover(last, NOW + 24 * UPGRADE_CAPTION_MS)).toBeNull();
  });
  test("no success status for failed, current, or missing outcomes", () => {
    expect(upgradeHover(null, NOW)).toBeNull();

    for (const result of ["current", "newer", "failed"] as const) {
      expect(upgradeCaption({ ...last, result }, undefined, NOW)).toBeNull();
      expect(upgradeHover({ ...last, result }, NOW)).toBeNull();
    }
  });
});

describe("a Daemon that replaced a stopped one (HostInfo.previousStop)", () => {
  const at = new Date(NOW).toISOString();
  const upgrade = { stop: { reason: "upgrade", fromVersion: "0.2.0", at }, version: "0.2.1" };

  test("the caption shows until this stop is seen, and for an hour at most", () => {
    expect(stopCaption(upgrade, undefined, NOW + 1000)).toBe("Upgraded to 0.2.1");
    expect(stopCaption(upgrade, at, NOW + 1000)).toBeNull();
    // Seeing an earlier stop doesn't hide this one.
    expect(stopCaption(upgrade, new Date(NOW - 5000).toISOString(), NOW)).toBe("Upgraded to 0.2.1");
    expect(stopCaption(upgrade, undefined, NOW + UPGRADE_CAPTION_MS)).toBeNull();
  });

  test("the hover says the terminals ended, not that everything kept working", () => {
    expect(stopHover(upgrade, NOW + 180_000)).toEqual({
      title: "Daemon upgraded to 0.2.1 · 3m ago",
      body: "From 0.2.0. Its terminals ended with the old daemon; agent sessions recovered.",
    });
    expect(stopHover(upgrade, NOW + 24 * UPGRADE_CAPTION_MS)).toBeNull();
  });

  test("a restart, or a reason this Client doesn't know, reads as a restart", () => {
    for (const reason of ["restart", "maintenance"]) {
      const restart = { ...upgrade, stop: { ...upgrade.stop, reason } };

      expect(stopCaption(restart, undefined, NOW)).toBe("Daemon restarted");
      expect(stopHover(restart, NOW)?.body).toBe(
        "The daemon (0.2.0) stopped and started again. Its terminals ended; agent sessions recovered."
      );
    }
  });
});
