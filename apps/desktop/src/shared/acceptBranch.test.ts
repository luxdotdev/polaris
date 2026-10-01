import { describe, expect, test } from "bun:test";
import { acceptBranchFor, acceptBranchMode, workspaceKeyOf } from "./acceptBranch.ts";
import { DEFAULT_SESSION_PREFS } from "./sessionPrefs.ts";

const onMain = { branch: "main", defaultBranch: "main", worktree: false };

const onFeature = { branch: "feature/x", defaultBranch: "main", worktree: false };

const NEW = "polaris/fix-login";

describe("where accepted work is committed", () => {
  test("by default, a branch only when on the default branch", () => {
    expect(DEFAULT_SESSION_PREFS.acceptBranch).toBe("auto");
    expect(acceptBranchFor("auto", onMain, NEW)).toEqual({ kind: "create", name: NEW });
    expect(acceptBranchFor("auto", onFeature, NEW)).toEqual({ kind: "current" });
  });

  test("committing to main is first-class", () => {
    expect(acceptBranchFor("current", onMain, NEW)).toEqual({ kind: "current" });
  });

  test("always branching branches from a feature branch too", () => {
    expect(acceptBranchFor("create", onFeature, NEW)).toEqual({ kind: "create", name: NEW });
  });

  test("a Worktree session uses its Worktree's branch whatever the setting", () => {
    const worktree = { branch: "polaris/abc", defaultBranch: "main", worktree: true };

    expect(acceptBranchFor("create", worktree, NEW)).toEqual({ kind: "current" });
  });

  test("a detached HEAD always gets a branch", () => {
    const detached = { branch: null, defaultBranch: "main", worktree: false };

    expect(acceptBranchFor("current", detached, NEW)).toEqual({ kind: "create", name: NEW });
  });

  test("an unknown default branch counts main and master as default", () => {
    const facts = { branch: "master", defaultBranch: null, worktree: false };

    expect(acceptBranchFor("auto", facts, NEW).kind).toBe("create");
    expect(acceptBranchFor("auto", { ...facts, branch: "dev" }, NEW).kind).toBe("current");
  });

  test("a Workspace's override wins over the default", () => {
    const key = workspaceKeyOf("local", "ws-1");

    const prefs = {
      acceptBranch: "auto" as const,
      workspaceAcceptBranch: { [key]: "current" as const },
    };

    expect(acceptBranchMode(prefs, key)).toBe("current");
    expect(acceptBranchMode(prefs, workspaceKeyOf("local", "ws-2"))).toBe("auto");
  });
});
