---
status: accepted (B; built in Polaris 0.3.0, ENG-274)
fixes: Codex workers can't run socket or port-binding checks, and no Claim receipt is ever Verified (ENG-274)
---

# Declared checks run by the Daemon

## Context

In ENG-252's Constellation, Codex workers couldn't run a Next.js production build (Turbopack's
PostCSS worker), HTTP smoke tests, `ps`-based leases or benchmarks. The Lead ran them outside the
sandbox and the workers recorded "Lead-run" Reported receipts. No receipt in that Constellation
was Verified. What main has on 2026-10-17:

- **The sandbox.** `auto` and `auto-edits` workers run in Codex's `workspace-write` with
  `networkAccess: false` (`harness/codex/mapping.ts`). Checked with codex-cli 0.162.1 on macOS:
  `Bun.serve` on 127.0.0.1 fails under it. With `network_access=true`, loopback works, but so
  does `https://example.com`, so the sandbox has no loopback-only setting. `ps` fails either way
  (`execvp() of 'ps' failed: Operation not permitted`), and so does `polaris lease`, which
  connects to the Daemon's Unix socket.
- **Receipt tiers.** `CheckReceipt` is `Verified { label, item: ToolCallReference }` or
  `Reported { label, text, command?, exitCode? }`. `evidence` (`constellation/attempts.ts`)
  makes an Attempt `verified` only when a reference resolves to a recorded, completed
  `CommandExecution` with exit 0, or to a completed `ToolCall` whose output decodes as
  `{ command, exitCode, output }`. A forged reference rejects with `E-RECEIPT-UNKNOWN`.
  `service.ts` resolves references from any session on the owning Host. `claimFacts.ts`
  resolves a remote worker's references from its own session only.
- **No reference reaches the worker.** The model never sees the turn and item ids of its own
  commands, and no worker tool returns them (`read_worker`, which shows commands, is Lead-only and
  prints no ids). A worker can't write a Verified receipt even for a check that passed inside
  the sandbox. That is why nothing was Verified, whatever the sandbox allowed.
- **Declared commands.** The only Daemon-run Workspace command is worktree setup
  (`constellation/setup/`): a per-Workspace setting (`SetWorktreeSetup`, user-only) or a lockfile
  default. It runs before the worker's first Turn, with Trust (`WorktreeSetupTrust`), the
  allowlisted environment (`setupEnv`, ADR 0054), a process-group kill and a 256 KiB output tail,
  and is recorded on the session (`session.setup`). Nothing else declares or runs checks.
- **Script leases (ENG-270, still Todo).** `tooling/leases.ts` takes `bench` or `smoke`.
  With `POLARIS_HOST_SOCKET` set it goes through `polaris lease` and the Host's resources, which
  answer `Unknown resource …; declare it on this Host first` until someone declares them.
  Without it, it falls back to a `/tmp/polaris-<name>-lock` directory.

## The constraint that decides it

Running a declared command doesn't stop the worker choosing what runs. `bun run build` runs the
worker's `package.json` script, `next.config.*`, PostCSS config and source, and the worker writes
all of them. If the Daemon runs a declared build without a sandbox, the worker can change the
script to anything and call the check, which is arbitrary unsandboxed execution as the user.
That code can also reach the Daemon's socket (user-only, but it runs as the user) and act as a
Client: approve its own Claim, grant Trust. A declaration limits which command line runs, not
what that command does. So the open choice is the sandbox the check runs in, not where checks
are declared.

The issue asks for "neither the sandbox nor the Lead in the loop"; this agent's brief says a
worker "must not get arbitrary unsandboxed execution through this". The two conflict for any
check that builds the worker's code. PRODUCT.md, CONTEXT.md (Trust covers "a Workspace's own
code", and setup runs before the worker writes any) and the ADRs don't settle which wins.

## Options

**A. Run the check without a sandbox, with gates.** Only in `auto` and `full-access`. In `auto`,
Codex's `on-request` approvals with `auto_review` can already approve an escalated `bun run build`
outside the sandbox, and that runs the same worker-written script. `full-access` has no sandbox at
all. Also needs Trust, the allowlisted environment with no `POLARIS_*` and no proxy variables,
and the worktree as cwd. This is the least work. It gives the worker unsandboxed execution
whenever it asks, with no model reviewer seeing the command, so the exposure is the same as
`auto`'s and the protection is weaker.

**B. Run the check in a sandbox the Daemon owns that allows loopback (recommended).**
The same file limits as Codex's `workspace-write`: write the worktree, a private temp dir and
declared cache dirs; deny `POLARIS_HOME` and the Daemon's socket. Network is loopback only: TCP
on `localhost`, and Unix sockets under the writable roots. On macOS that is a Seatbelt profile
through `sandbox-exec`, the mechanism Codex uses. On Linux, `bwrap --unshare-net` (a network
namespace with only `lo`) with bind mounts; with no bwrap, refuse. On Windows, refuse for now.
A refused check stays Reported. This meets the constraint and fixes the reported failures:
Turbopack's worker, localhost smoke tests, and the bench's throwaway Daemon on a `/tmp` socket.
The Daemon takes leases itself, so no `ps` runs inside. It does not fix checks that need the
internet (`next/font/google`, remote images): they stay Lead-run or Reported. It is
per-platform work and needs tests on each OS.

**C. Keep Codex's sandbox and route around it.** The Daemon's approval policy
(`answeredByPolicy`) approves an escalation request whose command line exactly matches a declared
check, and a tool returns the reference to the worker's own `CommandExecution`. The Daemon spawns
nothing new, but only Codex escalates. It has A's exposure and depends on Codex's escalation
format.

Not an option: `codex sandbox` with `network_access=true`. It allows loopback but also the
internet, and `workspace-write` reads the whole disk, so worker code could read `~/.ssh` and send
it out.

## Decision

B, decided by the owner on 2026-10-17. Checks that need the internet stay Reported, and Windows
refuses for now. It is built in Polaris 0.3.0; until then every check receipt stays Reported.

## Common to A and B

- **Declaration.** `.polaris/checks.json`:
  `{ "checks": { "<name>": { "run": "<shell line>", "timeoutSeconds": 900, "lease": "smoke" } } }`.
  The Daemon reads it at the Attempt's `base` commit (resolved at dispatch, see
  `constellation/worktrees.ts`) with automatic git (ADR 0056), never from the worktree. That is
  how `.polaris/review.md` is read at a PR's base so the PR can't change its own rules. A worker's
  edit to the file takes effect only after it is merged into a later base, which the Lead or the
  user accepted. Trust for the Workspace on this Host is required, as for setup.
- **Tool.** A worker (and Gate) tool `check { name }`. The Daemon looks the name up, runs `run`
  through `shellCommand` in `attempt.worktree`, one check at a time per worktree, holding the
  declared Host lease (`POLARIS_LEASE_HELD=<lease>`, so `takeScriptLease` doesn't take it again).
  Output keeps a 256 KiB tail and a timeout kills the process group. Unknown names, an
  untrusted Workspace, a missing sandbox or the wrong permission mode fail as findings, not
  defects.
- **Receipt.** The Daemon commits a `CommandExecution` item (id `polaris-check:<uuid>`, the
  declared command, cwd, output, exit code) into the caller's working Turn, then returns
  `Verified { label: name, item: { hostId, sessionId, turnId, itemId } }`, ready to put in
  `claim`. `evidence` already accepts it unchanged, so the Engine and spec semantics don't move.
  The trust assumption is today's: a Harness can't report an item under an id the Daemon chose
  (Harness ids aren't model-chosen).
- **Desktop.** The item shows as a command row in the worker's Turn. The `check` tool needs its own
  row in the Polaris tools list (DESIGN.md), designed under the product-design skill.

## Also found

`evidence` accepts any completed `ToolCall` whose output decodes as
`{ command, exitCode, output }`, whatever the tool. The Codex, Claude and ACP mappings store
third-party tools' output there (`result`, `tool_use_result`, `rawOutput`). A user's MCP server
that returns or echoes that shape would give a Verified receipt for a command the Daemon never
saw. The bench Harness's eval depends on this path. Filed separately (ENG-344).
