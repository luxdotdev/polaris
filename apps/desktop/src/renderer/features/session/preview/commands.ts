/** The preview's `harness.commands`: a few Skills and Slash Commands as Claude Code lists them. */
import type { CommandOption } from "../../composer/index.ts";

const entry = (name: string, description: string, extra: Partial<CommandOption> = {}) => ({
  name,
  sigil: "/" as const,
  description,
  argumentHint: null,
  kind: "skill" as const,
  source: "user" as const,
  plugin: null,
  run: "text" as const,
  action: null,
  template: null,
  ...extra,
});

export const COMMANDS: ReadonlyArray<CommandOption> = [
  entry("product-design", "Single entry point for product design and user-facing work in Polaris", {
    source: "project",
  }),
  entry(
    "simplify",
    "Review the changed code for reuse, simplification and efficiency, then fix it",
    {
      source: "built-in",
    }
  ),
  entry("tdd", "Test-driven development: red, green, refactor"),
  entry("codex:review", "Run a Codex code review against local git state", {
    source: "plugin",
    plugin: "codex",
  }),
  entry("compact", "Free up context by summarizing the conversation so far", {
    kind: "command",
    source: "built-in",
    argumentHint: "<optional instructions>",
  }),
  entry("init", "Initialize a new CLAUDE.md file with codebase documentation", {
    kind: "command",
    source: "built-in",
  }),
  entry("model", "Set the AI model for Claude Code", {
    kind: "command",
    source: "built-in",
    run: "polaris",
    action: "model",
  }),
  entry(
    "security-review",
    "Complete a security review of the pending changes on the current branch",
    {
      kind: "command",
      source: "built-in",
    }
  ),
];
