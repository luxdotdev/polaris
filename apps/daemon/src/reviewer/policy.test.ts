import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { isAllowedCommand, reviewerDecision } from "./policy.ts";

const sessionId = SessionId.make("ses-r");

describe("the Reviewer's read-only policy", () => {
  test.each([
    "git diff main...HEAD",
    "git log --oneline -5",
    "git -C sub show HEAD:src/a.ts",
    "rg -n 'useEffect' src",
    "cat src/a.ts | head -40",
    "sed -n 10,40p src/a.ts",
    "find src -name '*.ts'",
    "bun run typecheck",
    "bun test src/reviewer",
    "npm test",
    "pnpm lint",
    "cargo test",
    "go vet ./...",
    "python -m pytest -q",
    "npx tsc --noEmit",
    "bash -lc 'git diff --stat'",
  ])("allows %s", (line) => {
    expect(isAllowedCommand(line)).toBe(true);
  });

  test.each([
    "rm -rf src",
    "git commit -am x",
    "git push",
    "git -c core.pager=sh diff",
    "git diff --output=/tmp/x",
    "curl https://example.com",
    "cat a > b",
    "git diff; rm a",
    "echo $(whoami)",
    "find . -delete",
    "find . -exec rm {} ;",
    "sed -i s/a/b/ f",
    "sed -n 'w out' f",
    "bun run deploy",
    "npm install",
    "bash -lc 'rm -rf /'",
    "",
  ])("denies %s", (line) => {
    expect(isAllowedCommand(line)).toBe(false);
  });

  test("reads the command where each driver puts it", () => {
    const allow = reviewerDecision({
      sessionId,
      harness: "codex",
      kind: "command",
      title: "git diff",
      detail: "rm -rf /",
    });

    const deny = reviewerDecision({
      sessionId,
      harness: "claude",
      kind: "command",
      title: "git diff",
      detail: "rm -rf /",
    });

    expect(allow._tag).toBe("Allow");
    expect(deny._tag).toBe("Deny");
  });

  test("denies edits and other tools, and answers questions itself", () => {
    const base = { sessionId, harness: "claude" as const, title: "x", detail: "a.ts" };

    expect(reviewerDecision({ ...base, kind: "file-change" })._tag).toBe("Deny");
    expect(reviewerDecision({ ...base, kind: "tool" })._tag).toBe("Deny");
    expect(reviewerDecision({ ...base, kind: "question" })._tag).toBe("Answer");
  });
});
