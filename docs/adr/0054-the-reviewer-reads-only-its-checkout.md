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
what a sandboxed shell also needs (the repository's git common dir, PATH
directories that are neither `/` nor home or above), and what stays denied
(home, Polaris's state). The Reviewer's git gets `GIT_CONFIG_GLOBAL=/dev/null`,
because an unreadable `~/.gitconfig` is fatal to git and the user's config
can hold credential helpers. Each Harness enforces it with its own settings:

- **Claude Code**: `allowedTools` allows `Read(//<checkout>/**)` by path, not
  by tool name, so `dontAsk` refuses other reads; a Polaris `PreToolUse` hook
  also denies any Read, Glob or Grep whose path, pattern or link target
  leaves the checkout (SDK callback hooks run despite `disableAllHooks`, and
  in Subagents). Bash runs in the sandbox with `denyRead` on home and
  Polaris's state and `allowRead` for the checkout and the shell roots.
  `additionalDirectories` is empty. Verified on Claude Code 2.1.300: reads,
  globs and greps outside are refused with and without the hook, a Subagent
  is refused, `git log` works and `~/.zshrc` is not readable from Bash.
- **Codex**: the thread runs under a permission profile (`default_permissions`
  in `thread/start`'s config): `:minimal` and the roots readable, `/tmp` and
  `$TMPDIR` denied, nothing writable, no network. Neither `thread/start`'s
  `sandbox` nor `turn/start`'s `sandboxPolicy` is sent: Codex refuses a mode
  next to a profile, and a Turn's legacy policy would replace it for the
  thread. An app-server older than 0.159.2 (by `initialize`'s `userAgent`)
  could ignore the profile and fall back to the user's own sandbox, so the
  session doesn't start. Verified with `codex sandbox` on codex-cli 0.162.1.
- **OpenCode**: unchanged. Its supervised ruleset asks for
  `external_directory`, and the Reviewer's policy denies every ask.
- **ACP agents** read with their own tools, which Polaris can't confine: a
  read-only session is refused, with a line naming the Harnesses that can review.

## Limits

Tests and lint run only where the toolchain sits in a PATH directory; a
tool that needs files elsewhere in home fails inside the sandbox. Reads of
system paths outside home (Claude Code) or in `:minimal` (Codex) stay open.
