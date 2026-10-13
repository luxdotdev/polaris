---
status: accepted
implements: the Reviewer on a Linux Host without bubblewrap or socat (tester report, 2026-10-13)
---

# Without Claude Code's sandbox, the Reviewer gets no shell

The Reviewer reads untrusted changes, so it must stay read-only. With Claude
Code it ran Bash inside Claude Code's sandbox (no writes, no network) and set
`failIfUnavailable: true`, so on a Linux Host without `bwrap` or `socat` every
Risk Summary failed with Claude Code's raw "Sandbox required but unavailable".
The `claude` CLI and other Clients worked on the same Host because nothing
else turns the sandbox on: Polaris did, and only for the Reviewer.

## What we do

`harness/claude/sandbox.ts` checks the sandbox the way Claude Code does:
Seatbelt on macOS always, `bwrap` and `socat` on the PATH on Linux, nothing
elsewhere. Where it can start, nothing changes. Where it can't, the read-only
session drops Bash entirely: `tools` is Read/Glob/Grep/Agent, `Bash` is in
`disallowedTools`, the permission mode stays `dontAsk`, and `canUseTool` still
denies everything. The prompt tells the Reviewer it has no shell, and the Risk
Summary notes the Host and the install command.

## Why no shell rather than an allowlist

Without the sandbox, the only thing between a prompt-injected diff and the
Host would be a command allowlist. Read-only git is not read-only by prefix:
`git diff --output=<file>` writes, and repo config can name external diff
drivers. Read, Glob and Grep cannot write or reach the network by
construction, and Subagents only get tools from that set. The cost is a
weaker review on such Hosts: no tests, lint or `git log`, and base-side
content beyond the prompt's diff. The note says how to get it back.

## What stays fail-closed

If our check says the sandbox can start but Claude Code still can't start it
(user namespaces off, say), the session fails as before. Claude Code's error
is rewritten to name the Host and the missing tools, in agent sessions too,
where the sandbox is the user's own setting.

Codex is unchanged: its read-only sandbox ships inside the Codex binary and
needs no tools on the Host. Polaris sets no fail-if-unavailable switch for it,
so a Host where that sandbox can't apply shows up as refused commands inside
the Turn, not a failed start; that case has not been reproduced yet.
