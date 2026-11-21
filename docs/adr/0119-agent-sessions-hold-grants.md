---
status: accepted (ENG-1020)
---

# Agent Sessions hold Grants, and a CLI process inside one acts as it

## Context

Agents must be able to start Agent Sessions, send Turns and change settings, which spend
money and change the user's environment. Extensions already act under a Grant (ADR 0075,
0078); a local CLI connecting without a token has the user's full power. An agent running
`polaris session start` from Bash would have that power too.

## Decision

**Each Agent Session holds a Grant**, starting at `read` and `comment`. The first `start`,
`turn` or settings change raises an Approval: allow once, always for this session, or
always for this Workspace. Only the user grants; ADR 0100's user-only actions (approvals,
new authority, secrets) are never grantable. `turn` reaches only the session's own Starter
chain; any other session needs an Approval each time.

**A session's agents start sessions only on its own Host**, at most 5 running per Starter,
counted up the chain and raisable by the user. Workers that `dispatch` creates count
against their Constellation.

**Identity by process tree.** When a CLI connects over the local socket, the Daemon reads
the peer's process id and walks its ancestors; a process descended from a Harness process
the Daemon runs acts as that Agent Session, under its Grant. Environment variables are not
trusted: an agent can strip them. Only a process outside every session acts as the user.

## Consequences

- Shared Codex/OpenCode servers remain read-only unattributed agents until ENG-1027 separates their process trees.
- The same rule covers agents in any Harness, and any tool they run.
- A process that escapes the tree (double-fork into launchd, `ssh localhost`) is not caught;
  ADR 0100's user-key gate still protects the user-only actions.
