import { describe, expect, test } from "bun:test";
import { AttachmentId, SessionId, TurnId, WorkspaceId } from "@polaris/protocol";
import { Commands, Placement } from "../../../commands.ts";
import { parseUnifiedDiff, totals } from "./diff.ts";
import { formatElapsed, tildePath } from "./format.ts";
import {
  branchFromPrompt,
  defaultPlacement,
  forkStartCommands,
  isBranchName,
  type PlacementChoice,
  placementDir,
  resolvePlacement,
  startCommand,
  whereLine,
} from "./newSession.ts";

const ID_A = SessionId.make("3F9A2C1D-0000-4000-8000-000000000000");

const ID_B = SessionId.make("b71e04aa-0000-4000-8000-000000000000");

describe("new session", () => {
  const input = {
    sessionId: SessionId.make("s1"),
    workspaceId: WorkspaceId.make("w1"),
    harness: "codex" as const,
    permissionMode: "supervised" as const,
    model: { model: "gpt-5.5", effort: "high" },
    attachments: [AttachmentId.make("a1")],
  };

  test("the where line names the Host, path and Worktree", () => {
    expect(
      whereLine("Mac Studio", "~/code/polaris", {
        kind: "new-worktree",
        branch: "x",
        base: "main",
      })
    ).toBe("Runs on Mac Studio in ~/code/polaris, on a new worktree from main.");
    expect(
      whereLine(
        "Mac Studio",
        "~/code/polaris",
        { kind: "new-worktree", branch: "", base: null },
        "main"
      )
    ).toBe("Runs on Mac Studio in ~/code/polaris, on a new worktree from main.");
    expect(whereLine("this Mac", "~/p", { kind: "in-place" })).toBe(
      "Runs on this Mac in ~/p, in place."
    );
  });

  test("StartSession carries placement, permission mode, Model and effort", () => {
    expect(
      startCommand({
        ...input,
        placement: { kind: "new-worktree", branch: " feat/x ", base: "main" },
        prompt: " go ",
      })
    ).toEqual(
      Commands.StartSession({
        ...input,
        placement: Placement.NewWorktree({ branch: "feat/x", baseRef: "main" }),
        model: "gpt-5.5",
        effort: "high",
        prompt: "go",
      })
    );
  });

  test("an invalid branch or an empty draft starts nothing", () => {
    expect(
      startCommand({
        ...input,
        placement: { kind: "new-worktree", branch: "a b", base: null },
        prompt: "go",
      })
    ).toBeNull();
    expect(
      startCommand({ ...input, attachments: [], placement: { kind: "in-place" }, prompt: " " })
    ).toBeNull();
  });

  test("fork a turn: the Fork, then the prompt as its first Turn", () => {
    const fork = {
      sessionId: SessionId.make("s2"),
      fromSessionId: SessionId.make("s1"),
      fromTurnId: TurnId.make("t3"),
      harness: "claude",
      model: null,
      attachments: [],
    };

    expect(forkStartCommands({ ...fork, prompt: " try again " }).map((c) => c._tag)).toEqual([
      "ForkSession",
      "SendTurn",
    ]);
    const { attachments: _, ...forkFields } = fork;

    expect(forkStartCommands({ ...fork, prompt: "" })).toEqual([
      Commands.ForkSession({ ...forkFields, model: null, effort: null }),
    ]);
  });

  test("a branch from the prompt and the session's id", () => {
    expect(branchFromPrompt("Fix the login form's validation, please now", ID_A)).toBe(
      "polaris/fix-the-login-form-s-3f9a"
    );
    expect(branchFromPrompt("  ", ID_A)).toBe("polaris/session-3f9a");
    expect(isBranchName(branchFromPrompt("Add ~weird: chars?", ID_A))).toBe(true);
  });

  test("the same prompt twice never names the same branch", () => {
    const prompt = "Fix the flaky test";

    expect(branchFromPrompt(prompt, ID_A)).not.toBe(branchFromPrompt(prompt, ID_B));
    const worktree: PlacementChoice = { kind: "new-worktree", branch: "", base: null };
    const a = resolvePlacement(worktree, prompt, ID_A);
    const b = resolvePlacement(worktree, prompt, ID_B);

    expect(a).not.toEqual(b);
    // A branch the user named is kept as is; the Daemon refuses a taken one.
    const named: PlacementChoice = { kind: "new-worktree", branch: "spike/x", base: null };

    expect(resolvePlacement(named, prompt, ID_A)).toEqual(named);
  });

  test("the where line says when other sessions share the directory", () => {
    const here: PlacementChoice = { kind: "in-place" };

    expect(whereLine("Mac Studio", "~/code/polaris", here)).toBe(
      "Runs on Mac Studio in ~/code/polaris, in place."
    );
    expect(whereLine("Mac Studio", "~/code/polaris", here, null, 1)).toBe(
      "Runs on Mac Studio in ~/code/polaris, in place alongside 1 other session."
    );
    expect(whereLine("Mac Studio", "~/code/polaris", here, null, 2)).toBe(
      "Runs on Mac Studio in ~/code/polaris, in place alongside 2 other sessions."
    );
    expect(placementDir(here, "/w")).toBe("/w");
    expect(placementDir({ kind: "existing", path: "/w/t", branch: null }, "/w")).toBe("/w/t");
    expect(placementDir({ kind: "new-worktree", branch: "", base: null }, "/w")).toBeNull();
  });

  test("new sessions work in the Workspace directory unless Settings asks for a worktree", () => {
    expect(defaultPlacement(true, false)).toEqual({ kind: "in-place" });
    expect(defaultPlacement(false, true)).toEqual({ kind: "in-place" });
    expect(defaultPlacement(true, true)).toEqual({ kind: "new-worktree", branch: "", base: null });
    expect(resolvePlacement({ kind: "in-place" }, "Fix it", ID_A)).toEqual({ kind: "in-place" });
  });

  test("branch names", () => {
    expect(["feat/x", "spike-1", "a.b"].every(isBranchName)).toBe(true);
    expect(["", "a b", "a..b", "-x", "x/", "x.", "a~1", "a@{u}"].some(isBranchName)).toBe(false);
  });
});

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 import x
-const a = 1;
+const a = 2;
+const b = 3;
 export {}
\\ No newline at end of file
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
diff --git a/old.png b/old.png
deleted file mode 100644
Binary files a/old.png and /dev/null differ
diff --git a/x.ts b/y.ts
similarity index 90%
rename from x.ts
rename to y.ts
`;

describe("unified diff", () => {
  const files = parseUnifiedDiff(PATCH);

  test("files, statuses and counts", () => {
    expect(files.map((f) => [f.path, f.status, f.added, f.removed, f.binary])).toEqual([
      ["src/a.ts", "modified", 2, 1, false],
      ["new.txt", "added", 1, 0, false],
      ["old.png", "deleted", 0, 0, true],
      ["y.ts", "renamed", 0, 0, false],
    ]);
    expect(files[3]?.oldPath).toBe("x.ts");
    expect(totals(files)).toEqual({ files: 4, added: 3, removed: 1 });
  });

  test("line numbers on each side", () => {
    const lines = files[0]?.hunks[0]?.lines ?? [];

    expect(lines.map((l) => [l.kind, l.oldNumber, l.newNumber])).toEqual([
      ["context", 1, 1],
      ["remove", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
    ]);
  });

  test("an empty diff has no files", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("format", () => {
  test("elapsed", () => {
    expect([0, 12_400, 72_000, 7_500_000].map(formatElapsed)).toEqual([
      "0s",
      "12s",
      "1m 12s",
      "2h 5m",
    ]);
  });

  test("home becomes ~", () => {
    expect(tildePath("/Users/me/code/p", "/Users/me")).toBe("~/code/p");
    expect(tildePath("/Users/meta", "/Users/me")).toBe("/Users/meta");
    expect(tildePath("/srv/p", null)).toBe("/srv/p");
  });
});
