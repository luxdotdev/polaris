import { describe, expect, test } from "bun:test";
import { HarnessAvailability, HostHarnesses } from "@polaris/protocol";
import { hostModel, hostView, workspaces } from "../../routes/fixtures.testing.ts";
import type { HostModel } from "../../store/hostModel.ts";
import { drivesLine, foundLine, listed, onboardingStage } from "./model.ts";

const synced = (model: HostModel): HostModel => ({ ...model, synchronized: true });

const local = hostView("local");

const studio = hostView("studio");

describe("onboardingStage", () => {
  test("the welcome comes first, whatever the Hosts hold", () => {
    const models = { local: synced(hostModel(workspaces("w", 2))) };

    expect(onboardingStage({ welcome: "show", hosts: [local], models })).toBe("welcome");
  });

  test("no Workspace on any Host opens to the setup", () => {
    const models = { local: synced(hostModel([])), studio: synced(hostModel([])) };

    expect(onboardingStage({ welcome: "seen", hosts: [local, studio], models })).toBe("setup");
  });

  test("one Workspace anywhere opens the Orchestrator", () => {
    const models = { local: synced(hostModel([])), studio: synced(hostModel(workspaces("w", 1))) };

    expect(onboardingStage({ welcome: "seen", hosts: [local, studio], models })).toBe("shell");
  });

  test("the setup comes back when the last Workspace goes", () => {
    const models = { local: synced(hostModel([{ id: "w0", hidden: true }])) };

    expect(onboardingStage({ welcome: "seen", hosts: [local], models })).toBe("setup");
  });

  test("before any Host answers, the stage waits instead of flashing the setup", () => {
    expect(onboardingStage({ welcome: "seen", hosts: [local], models: {} })).toBe("waiting");
    expect(
      onboardingStage({ welcome: "unknown", hosts: [local], models: { local: hostModel([]) } })
    ).toBe("waiting");
  });

  test("Workspaces painted from the cache count before the Host answers", () => {
    const cached = { ...hostModel(workspaces("w", 1)), fromCache: true };

    expect(onboardingStage({ welcome: "seen", hosts: [local], models: { local: cached } })).toBe(
      "shell"
    );
  });
});

const reported = (harness: string, status: HarnessAvailability["status"], version: string | null) =>
  new HarnessAvailability({
    harness,
    status,
    version,
    minVersion: "0",
    detail: null,
    signInArgv: null,
  });

const availability = new HostHarnesses({
  checkedAt: "2026-09-30T00:00:00.000Z",
  harnesses: [
    reported("claude", "ready", "2.1.4"),
    reported("codex", "needs-sign-in", "0.52.0"),
    reported("opencode", "not-installed", null),
  ],
});

describe("found on this Mac", () => {
  test("installed Harnesses with versions, then the ssh hosts", () => {
    expect(foundLine(availability, 14)).toBe(
      "Claude Code 2.1.4 · Codex 0.52.0 · 14 hosts in ~/.ssh/config"
    );
    expect(foundLine(availability, 1)).toContain("1 host in ~/.ssh/config");
    expect(foundLine(null, 0)).toBe("No agents yet");
  });

  test("names join the way a sentence does", () => {
    expect(listed(["Claude Code 2.1.4"])).toBe("Claude Code 2.1.4");
    expect(listed(["A", "B", "C"])).toBe("A, B and C");
    expect(listed(["A", "B", "C", "D"], 2)).toBe("A, B and 2 more");
  });

  test("the welcome names what Polaris drives in a line that fits", () => {
    expect(drivesLine([], ["Claude Code", "Codex", "OpenCode"])).toBe(
      "Claude Code, Codex and more"
    );
    expect(drivesLine(["Codex"], ["Claude Code", "Codex"])).toBe("Codex");
  });
});
