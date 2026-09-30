import { describe, expect, test } from "bun:test";
import { type DaemonBuild, InstallPlan, planInstall } from "@polaris/client/install";
import {
  type InstallEvent,
  type InstallSnapshot,
  initialInstall,
  installMachine,
  stepInstall,
} from "./installFlow.ts";

const build: DaemonBuild = {
  platform: "linux-arm64",
  version: "0.2.0",
  sha256: "abc123",
  files: [{ name: "polaris", path: "/dist/linux-arm64/polaris", sha256: "abc123", size: 1 }],
};

const run = (...events: ReadonlyArray<InstallEvent>): InstallSnapshot =>
  events.reduce(stepInstall, initialInstall());

const probe = (installed: string | null) => ({
  os: "Linux",
  arch: "aarch64",
  installed: installed === null ? null : { version: installed, platform: "linux-arm64" },
});

/** The plan the real planner makes for this probe, trigger and approvals. */
const plan = (
  installed: string | null,
  trigger: "user" | "background",
  approved: ReadonlyArray<string>
) => planInstall(probe(installed), [build], { trigger, approvedSha256: new Set(approved) });

describe("install flow", () => {
  test("first install: ask, approve, re-check, install", () => {
    const asked = run(
      { type: "check", trigger: "user" },
      { type: "planned", plan: plan(null, "user", []) }
    );

    expect(asked.value).toBe("approval");
    expect(asked.context.offer).toEqual({
      platform: "linux-arm64",
      version: "0.2.0",
      sha256: "abc123",
    });

    const approved = stepInstall(asked, { type: "approve" });
    expect([approved.value, approved.context.trigger]).toEqual(["checking", "user"]);

    const installing = stepInstall(approved, {
      type: "planned",
      plan: plan(null, "user", ["abc123"]),
    });

    expect(installing.value).toBe("installing");

    const done = stepInstall(installing, {
      type: "applied",
      outcome: { kind: "installed", version: "0.2.0", from: null, notes: [], adminCommand: null },
    });

    expect([done.value, done.context.outcome?.kind]).toEqual(["ready", "installed"]);
  });

  test("a background check never installs, even with the SHA-256 approved", () => {
    const planned = plan(null, "background", ["abc123"]);
    expect(planned._tag).toBe("NeedsApproval");
    expect(
      run({ type: "check", trigger: "background" }, { type: "planned", plan: planned }).value
    ).toBe("approval");

    // Even an Install plan arriving on a background check only asks.
    const forced = run(
      { type: "check", trigger: "background" },
      { type: "planned", plan: InstallPlan.Install({ build }) }
    );

    expect([forced.value, forced.context.work]).toEqual(["approval", null]);
  });

  test("no state reachable from a background check is installing on an Install plan", () => {
    // SAFETY: the machine's config keys are exactly its state values.
    const states = Object.keys(installMachine.config.states) as ReadonlyArray<
      InstallSnapshot["value"]
    >;

    for (const value of states) {
      const from: InstallSnapshot = { ...initialInstall(), value };
      const checked = stepInstall(from, { type: "check", trigger: "background" });

      if (checked.value !== "checking") continue;
      const next = stepInstall(checked, { type: "planned", plan: InstallPlan.Install({ build }) });
      expect(next.value).not.toBe("installing");
    }
  });

  test("upgrades need no approval, on any trigger, and say they happened", () => {
    const upgrading = run(
      { type: "check", trigger: "background" },
      { type: "planned", plan: plan("0.1.0", "background", []) }
    );

    expect(upgrading.value).toBe("installing");

    const done = stepInstall(upgrading, {
      type: "applied",
      outcome: { kind: "upgraded", version: "0.2.0", from: "0.1.0", notes: [], adminCommand: null },
    });

    expect(done.context.outcome).toEqual({
      kind: "upgraded",
      version: "0.2.0",
      from: "0.1.0",
      notes: [],
      adminCommand: null,
    });
  });

  test("not now parks the Host until the user checks again", () => {
    const parked = run(
      { type: "check", trigger: "user" },
      { type: "planned", plan: plan(null, "user", []) },
      { type: "dismiss" }
    );

    expect(parked.value).toBe("dismissed");
    expect(stepInstall(parked, { type: "check", trigger: "background" }).value).toBe("dismissed");
    expect(stepInstall(parked, { type: "check", trigger: "user" }).value).toBe("checking");
  });

  test("up to date, newer, unsupported, host setup and failures", () => {
    const check = { type: "check", trigger: "user" } as const;
    expect(
      run(check, { type: "planned", plan: plan("0.2.0", "user", []) }).context.outcome?.kind
    ).toBe("current");
    expect(
      run(check, { type: "planned", plan: plan("0.3.0", "user", []) }).context.outcome
    ).toEqual({
      kind: "newer",
      version: "0.3.0",
      from: null,
      notes: [],
      adminCommand: null,
    });

    const unsupported = run(check, {
      type: "planned",
      plan: InstallPlan.Unsupported({ os: "FreeBSD", arch: "amd64" }),
    });

    expect([unsupported.value, unsupported.context.problem?.kind]).toEqual([
      "blocked",
      "unsupported",
    ]);

    const setup = run(check, {
      type: "planned",
      plan: InstallPlan.MissingLibraries({
        platform: "linux-arm64-musl",
        libraries: ["libstdc++.so.6"],
        command: "apk add libstdc++ libgcc",
      }),
    });

    expect(setup.context.problem?.command).toBe("apk add libstdc++ libgcc");

    const failed = run(check, {
      type: "failed",
      problem: { kind: "failed", message: "Permission denied", command: null },
    });

    expect(failed.value).toBe("blocked");
    expect(stepInstall(failed, check).value).toBe("checking");
  });

  test("checks and approvals are ignored mid-flight", () => {
    const checking = run({ type: "check", trigger: "user" });
    expect(stepInstall(checking, { type: "check", trigger: "user" })).toBe(checking);
    expect(stepInstall(checking, { type: "approve" }).value).toBe("checking");
  });
});
