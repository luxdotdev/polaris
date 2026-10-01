import { describe, expect, test } from "bun:test";
import type { HarnessAvailability } from "@polaris/protocol";
import type { Plain } from "../../../../shared/api.ts";
import type { ProbedHost } from "./harnesses.ts";
import {
  type HostReviewer,
  overridesOf,
  readySummary,
  reviewerHostRows,
  reviewerTitle,
  sharedDefault,
  SOL,
  withDefault,
  withOverride,
} from "./reviewer.ts";

const codex = (status: "ready" | "needs-sign-in"): Plain<HarnessAvailability> => ({
  harness: "codex",
  status,
  version: "0.61.0",
  minVersion: "0.50.0",
  signInArgv: ["codex", "login"],
  signInKind: status === "ready" ? "ChatGPT Pro" : null,
  olderThanTested: null,
  detail: null,
});

const host = (hostKey: string, label: string, status: "ready" | "needs-sign-in"): ProbedHost => ({
  hostKey,
  label,
  probe: {
    kind: "reported",
    report: { harnesses: [codex(status)], checkedAt: "2026-10-01T00:00:00Z" },
  },
});

const WHEN = { onPullRequests: true, onSessions: true, askAboveLines: 2000 };

const loaded = (choice = SOL, workspaces = {}): HostReviewer => ({
  kind: "loaded",
  settings: { default: choice, workspaces, ...WHEN },
  resolved: { choice, source: "settings", note: null },
});

describe("the Reviewer every host runs", () => {
  test("the default is shared; a host that disagrees is flagged", () => {
    expect(sharedDefault([loaded(), loaded()])).toEqual({ choice: SOL, differs: false });
    expect(sharedDefault([loaded(), { kind: "loading" }]).differs).toBe(false);
    expect(sharedDefault([loaded(), loaded({ ...SOL, effort: "low" })]).differs).toBe(true);
  });

  test("the heading names it, or says it picks automatically", () => {
    expect(reviewerTitle(SOL, () => "GPT-6.1-Sol")).toBe("Reviews with Codex · GPT-6.1-Sol · high");
    expect(reviewerTitle(null)).toBe("Picks a reviewer automatically");
    expect(reviewerTitle(SOL)).toBe("Reviews with Codex · GPT-6.1-Sol · high");
  });

  test("each host says whether its reviewer can run; one that can't runs rules only", () => {
    const hosts = [host("local", "Mac Studio", "ready"), host("vm", "Linux VM", "needs-sign-in")];
    const rows = reviewerHostRows(hosts, { local: loaded(), vm: loaded() }, { local: 3 });

    expect(rows.map((r) => [r.hostLabel, r.text, r.caption, r.aside])).toEqual([
      ["Mac Studio", "Ready · ChatGPT Pro", null, "3 review checkouts"],
      [
        "Linux VM",
        "Needs sign-in",
        "Risk summaries for checkouts here run rules only",
        "No checkouts",
      ],
    ]);
    expect(readySummary(rows)).toBe("Ready on 1 of 2 hosts");
  });

  test("a host whose daemon can't run a reviewer says so", () => {
    const rows = reviewerHostRows(
      [host("pi", "Raspberry Pi 4", "ready")],
      { pi: { kind: "unavailable", reason: "This host's daemon can't run a reviewer" } },
      {}
    );

    expect(rows[0]?.text).toBe("This host's daemon can't run a reviewer");
  });

  test("automatic with nothing available is rules only, with the Daemon's note", () => {
    const none: HostReviewer = {
      kind: "loaded",
      settings: { default: null, workspaces: {}, ...WHEN },
      resolved: { choice: null, source: "auto", note: "No reviewer harness is ready" },
    };

    const [row] = reviewerHostRows([host("local", "Mac", "ready")], { local: none }, {});

    expect(row?.caption).toBe("No reviewer harness is ready");
  });

  test("changing the default keeps overrides; overrides are set and cleared per Workspace", () => {
    const settings = { default: null, workspaces: { w1: SOL }, ...WHEN };

    expect(withDefault(settings, SOL)).toEqual({ default: SOL, workspaces: { w1: SOL }, ...WHEN });
    expect(withOverride(settings, "w1", null)).toEqual({ default: null, workspaces: {}, ...WHEN });
    expect(withOverride(settings, "w2", SOL).workspaces).toEqual({ w1: SOL, w2: SOL });
    expect(overridesOf({ local: loaded(SOL, { w1: SOL }) })).toEqual({ "local/w1": SOL });
  });
});
