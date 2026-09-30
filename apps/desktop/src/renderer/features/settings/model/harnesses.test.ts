import { describe, expect, test } from "bun:test";
import type { HarnessAvailability } from "@polaris/protocol";
import type { Plain } from "../../../../shared/api.ts";
import { harnessGroups, type ProbedHost } from "./harnesses.ts";

const availability = (
  harness: string,
  status: HarnessAvailability["status"],
  version: string | null = "1.0.0"
): Plain<HarnessAvailability> => ({
  harness,
  status,
  version,
  minVersion: "2.1.0",
  detail: null,
  signInArgv: status === "not-installed" ? null : [`/usr/local/bin/${harness}`, "login"],
});

const reported = (
  hostKey: string,
  harnesses: ReadonlyArray<Plain<HarnessAvailability>>
): ProbedHost => ({
  hostKey,
  label: hostKey,
  probe: { kind: "reported", report: { harnesses, checkedAt: "2026-09-30T00:00:00Z" } },
});

const group = (hosts: ReadonlyArray<ProbedHost>, kind: string) => {
  const found = harnessGroups(hosts).find((g) => g.kind === kind);

  if (found === undefined) throw new Error(`no group ${kind}`);

  return found;
};

describe("harnessGroups", () => {
  test("one group per catalogue Harness, one row per Host", () => {
    const groups = harnessGroups([reported("studio", []), reported("vm", [])]);

    expect(groups.map((g) => g.kind)).toEqual(["claude", "codex", "opencode", "gemini", "copilot"]);
    expect(groups.every((g) => g.rows.length === 2)).toBe(true);
  });

  test("at most one action: sign in runs the Harness's own argv, never an install", () => {
    const claude = group(
      [
        reported("studio", [availability("claude", "ready", "2.1.84")]),
        reported("vm", [availability("claude", "needs-sign-in")]),
        reported("mbp", [availability("claude", "outdated", "2.0.71")]),
        reported("pi", [availability("claude", "not-installed", null)]),
      ],
      "claude"
    );

    expect(claude.rows.map((r) => [r.text, r.action?.kind ?? null])).toEqual([
      ["Ready", null],
      ["Needs sign-in", "sign-in"],
      ["Needs 2.1.0 or later", "setup-guide"],
      ["Not installed", "setup-guide"],
    ]);
    expect(claude.rows[1]?.action).toEqual({
      kind: "sign-in",
      argv: ["/usr/local/bin/claude", "login"],
    });
    expect(claude.rows[3]?.action).toEqual({
      kind: "setup-guide",
      url: "https://code.claude.com/docs/en/setup",
    });
    expect(claude.summary).toBe("Ready on 1 of 4 hosts");
    expect(claude.collapsible).toBe(false);
  });

  test("ready everywhere collapses, with the shared version", () => {
    const codex = group(
      [
        reported("studio", [availability("codex", "ready", "0.61.0")]),
        reported("vm", [availability("codex", "ready", "0.61.0")]),
      ],
      "codex"
    );

    expect([codex.summary, codex.collapsible]).toEqual(["Ready on all 2 hosts · 0.61.0", true]);
  });

  test("a Host that can't report gets words and no action", () => {
    const hosts: ReadonlyArray<ProbedHost> = [
      { hostKey: "pi", label: "Raspberry Pi 4", probe: { kind: "offline" } },
      { hostKey: "old", label: "Old", probe: { kind: "unsupported" } },
    ];

    expect(group(hosts, "claude").rows.map((r) => [r.text, r.action])).toEqual([
      ["Host not connected", null],
      ["This host's daemon can't report harnesses", null],
    ]);
    expect(group(hosts, "claude").summary).toBe("Not ready on any host yet");
  });
});
