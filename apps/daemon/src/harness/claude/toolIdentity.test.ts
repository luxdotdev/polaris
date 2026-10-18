import { describe, expect, test } from "bun:test";
import { toolIdentity } from "./toolIdentity.ts";

describe("toolIdentity", () => {
  test.each([
    ["mcp__paper__write_html", "mcp", { server: "paper", tool: "write_html" }],
    [
      "mcp__claude_ai_Linear__save_issue",
      "mcp",
      { server: "claude_ai_Linear", tool: "save_issue" },
    ],
    ["mcp__polaris_2__plan", "mcp", { server: "polaris_2", tool: "plan" }],
    ["mcp__srv__a__b", "mcp", { server: "srv", tool: "a__b" }],
    ["Skill", "skill", null],
    ["ToolSearch", "other", null],
    ["mcp__paper", "other", null],
    ["mcp____tool", "other", null],
    ["mcp__paper__", "other", null],
  ] as const)("%s is %s", (name, kind, mcp) => {
    expect(toolIdentity(name)).toEqual({ kind, mcp });
  });
});
