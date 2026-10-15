---
status: accepted
fixes: a prompt-injected Reviewer could read files outside its checkout (security audit, 2026-10-15)
---

# The Reviewer reads only its checkout

## Context

The Reviewer's prompt carries untrusted text: the pull request's
description, the repo's review instructions and the diff. Read-only stopped
writes and network, not reads. Claude Code allowed `Read`, `Glob` and
`Grep` by tool name, so any path; Codex ran the legacy `read-only` sandbox,
which reads the whole disk. Anything the Host user can read (`~/.ssh`,
`~/.aws`, `~/.polaris`, other repositories) could reach the model.

## What we do

`harness/confinement.ts` works out, per session: the checkout (canonical),
what a sandboxed shell also needs, and what stays denied (home, Polaris's
state, the repository's git common dir). The shell gets PATH directories
that are neither `/` nor inside or above a denied path (so `/Users` can't
reopen home), and, in a linked worktree, only what git needs of the common
dir: `objects`, `refs`, `packed-refs`, `HEAD`, `reftable`, `shallow`, `info`
and the checkout's own git dir. Never `config`, whose remote URLs and
headers can carry tokens, nor other worktrees. Git reads a sanitized copy
(`harness/confinedGit.ts`: format and `extensions.*` only, with links to the
shared parts) through `GIT_COMMON_DIR`, and `GIT_CONFIG_GLOBAL=/dev/null`,
because an unreadable config is fatal to git and the user's can hold
credential helpers. A checkout that isn't a linked worktree gets no git dir.

- **Claude Code**: `allowedTools` allows `Read(//<checkout>/**)` by path, not
  by tool name, so `dontAsk` refuses other reads; a Polaris `PreToolUse` hook
  also denies any Read, Glob or Grep whose path, pattern or link target
  leaves the checkout (SDK callback hooks run despite `disableAllHooks`, and
  in Subagents). The hook refuses what Claude Code would read differently
  than Polaris: `~`, `$HOME`, `%USERPROFILE%`, `file:`, `\` and any `..`
  segment (the OS follows a link before `..`, a lexical resolve doesn't).
  Bash runs in the sandbox with `denyRead` on the denied paths and
  `allowRead` for the checkout and the shell roots, and its environment is
  an allowlist (the shell basics, Claude Code's own `ANTHROPIC_*`/`CLAUDE_*`,
  proxies and certificates, a cloud provider's only while Claude Code uses
  it), so the Daemon's other tokens never reach it. `additionalDirectories`
  is empty and there are no MCP servers. Verified on Claude Code 2.1.300:
  reads, globs and greps outside are refused with and without the hook, a
  Subagent is refused, `git log` works and `~/.zshrc` is not readable from Bash;
  git through the sanitized copy, with the common dir denied but its shared
  parts allowed, verified under Seatbelt (`sandbox-exec`).
- **Codex**: the thread runs under a permission profile (`default_permissions`
  in `thread/start`'s config): `:minimal` and the roots readable, `/tmp` and
  `$TMPDIR` denied, nothing writable, no network. Neither `thread/start`'s
  `sandbox` nor `turn/start`'s `sandboxPolicy` is sent: Codex refuses a mode
  next to a profile, and a Turn's legacy policy would replace it for the
  thread. An app-server older than 0.159.2 (by `initialize`'s `userAgent`)
  could ignore the profile and fall back to the user's own sandbox, so the
  session doesn't start. MCP servers, plugins, apps, hooks and browser or
  computer use run outside the sandbox: Polaris asks `config/read` (with the
  checkout as `cwd`, so project layers count) for the user's servers and
  plugins and turns each off, with those features, memories and web search;
  without that answer the session doesn't start. Commands inherit only
  Codex's `core` variables. Verified with `codex sandbox` and an ephemeral
  `thread/start` (every MCP server `disabled`) on codex-cli 0.162.1.
- **OpenCode**: unchanged. Its supervised ruleset asks for
  `external_directory`, and the Reviewer's policy denies every ask.
- **ACP agents** read with their own tools, which Polaris can't confine: a
  read-only session is refused, with a line naming the Harnesses that can review.

## Limits

Tests and lint run only where the toolchain sits in a PATH directory; a
tool that needs files elsewhere in home fails inside the sandbox. Reads of
system paths outside home (Claude Code) or in `:minimal` (Codex) stay open.
Claude Code's own provider credentials stay in its environment, so Bash can
see them; Codex keeps its own out of commands.
