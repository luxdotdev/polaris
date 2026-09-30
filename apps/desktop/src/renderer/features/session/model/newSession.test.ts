import { describe, expect, test } from "bun:test";
import { AttachmentId, SessionId, TurnId, WorkspaceId } from "@polaris/protocol";
import { Commands, Placement } from "../../../commands.ts";
import { parseUnifiedDiff, totals } from "./diff.ts";
import { formatElapsed, tildePath } from "./format.ts";
import {
  choose,
  defaultChoice,
  effortFor,
  type ModelData,
  modelLabel,
  pickableModels,
} from "./models.ts";
import {
  branchFromPrompt,
  forkStartCommands,
  isBranchName,
  startCommand,
  whereLine,
} from "./newSession.ts";

const model = (id: string, patch: Partial<ModelData> = {}): ModelData => ({
  id,
  name: id.toUpperCase(),
  description: null,
  efforts: ["low", "medium", "high"],
  defaultEffort: "medium",
  isDefault: false,
  ...patch,
});

const claude = [
  model("default", { name: "Default (recommended)", isDefault: true, defaultEffort: null }),
  model("opus", { name: "Opus 5", defaultEffort: null }),
  model("haiku", { name: "Haiku", efforts: [], defaultEffort: null }),
];

describe("model picker", () => {
  test("Claude's default row is hidden; other Harnesses keep every row", () => {
    expect(pickableModels("claude", claude).map((m) => m.id)).toEqual(["opus", "haiku"]);
    expect(pickableModels("codex", claude)).toHaveLength(3);
  });

  test("the effort sent is the pick if supported, else the Model's default", () => {
    const gpt = model("gpt-5.5", { defaultEffort: "medium" });

    expect(effortFor(gpt, "high")).toBe("high");
    expect(effortFor(gpt, "xhigh")).toBe("medium");
    expect(effortFor(gpt, null)).toBe("medium");
    expect(choose(gpt)).toEqual({ model: "gpt-5.5", effort: "medium" });
  });

  test("a null Model reads as Default", () => {
    expect(modelLabel(claude, null, null)).toBe("Default");
    expect(modelLabel(claude, "opus", "high")).toBe("Opus 5 · high");
    expect(modelLabel([], "gpt-9", null)).toBe("gpt-9");
  });

  test("a new session starts on the Harness's default; Claude sends null", () => {
    expect(defaultChoice("claude", claude)).toBeNull();
    expect(defaultChoice("codex", [model("a"), model("b", { isDefault: true })])).toEqual({
      model: "b",
      effort: "medium",
    });
  });
});

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

  test("a branch from the prompt", () => {
    expect(branchFromPrompt("Fix the login form's validation, please now", "x")).toBe(
      "polaris/fix-the-login-form-s"
    );
    expect(branchFromPrompt("  ", "1234")).toBe("polaris/1234");
    expect(isBranchName(branchFromPrompt("Add ~weird: chars?", "x"))).toBe(true);
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
