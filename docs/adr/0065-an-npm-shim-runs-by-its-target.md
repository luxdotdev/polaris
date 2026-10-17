---
status: accepted
fixes: on Windows an npm-installed Claude Code (`claude.cmd`) couldn't start an Agent Session or run an inline edit or commit message
---

# A Harness behind an npm `.cmd` shim is run by its target

## Context

npm installs a package's `bin` on Windows as a `.cmd` shim that cmd.exe runs. Measured on
Windows 11 with Bun 1.4.3 and Claude Code 2.1.302 installed by npm 9:

- `Bun.spawn` runs a `.cmd` through cmd.exe, and refuses any argument holding a character
  cmd.exe would expand (`"`, `%`): "contains a cmd.exe special character and cannot be safely
  passed to a .bat/.cmd file". Print mode's `--json-schema`, `--mcp-config` and `--settings`
  are JSON, so every inline edit and commit message through `claude.cmd` failed.
- node's `child_process.spawn` (which the Agent SDK uses) won't start a `.cmd` without
  `shell: true` at all: `spawn … claude.cmd EINVAL`, for any arguments. Every Agent Session,
  model and command listing through `claude.cmd` failed.
- Claude Code's npm package has `"bin": { "claude": "bin/claude.exe" }`, so its shim is one
  line, `"%dp0%\..\@anthropic-ai\claude-code\bin\claude.exe" %*`. A script `bin` (older
  Claude Code's `cli.js`, Copilot's `index.js`) gets `"%_prog%" "%dp0%\…\cli.js" %*`, with
  `_prog` the shebang's interpreter beside the shim, else on PATH.
- The native installer's `claude.exe` has neither problem.

## Decision

- **Read the shim, run its target** (`platform/cmdShim.ts`): the last line that passes `%*`,
  after its last `&`, with `%dp0%`/`%~dp0` and `%_prog%` filled in. The program and every
  absolute path in it must exist. Anything else (another tool's `.cmd`, a missing target) is
  run as before, so Bun's refusal still guards it; no argument ever goes through cmd.exe.
- **Every Claude spawn uses it**: print mode (`inline/claude.ts`) prepends the target to its
  argv; the Agent SDK's callers pass `claudeExecutable(path)`, the target `claude.exe`, or a
  `cli.js` with `executable: "node"` (the SDK then runs the `node` on PATH, as the shim
  would when none is beside it).
- **The other Harnesses keep their shims.** Codex, OpenCode, Gemini and Copilot are given
  only plain arguments (`app-server`, `serve --port 0`, `--acp`, `--version`), which Bun
  passes to a `.cmd`; the Windows Codex app-server's cmd.exe line refuses `%` and `"`
  (ADR 0061).

## Consequences

- A shim written by another tool (pnpm, Yarn, scoop's `.cmd`) that passes JSON still fails,
  with Bun's or node's error.
- Killing the target ends the Harness itself; there is no cmd.exe left to end.
