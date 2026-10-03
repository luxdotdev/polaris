# Constellation Daemon composition

`transport/serve.ts` builds the existing Engine and lightweight delegating
Harness/Liveness proxies. `transport/lazy.ts` imports this composition once on
the first Constellation or transfer RPC. The same Daemon Scope, MemoMap and base
service Context own the resulting resources; streaming RPCs retain the request
Scope and BlobChannel. Startup activates the composition only for folded graphs
or durable remote assignments, after Session-machine recovery and before serving.

Owner identity, transfer storage, MCP credentials, loopback MCP and delivery
are created inside that boundary. HostResources uses an independent cached proxy,
activated on the first Resource RPC or working-slot acquisition. Existing process
leases force startup activation so process monitoring and recovery still run.

Preparation uses W's worktree/bundle boundary and the pure Session machine to
allocate a Session without a Turn. Retries reusing the same Session and existing
worktree commit SendBack immediately even during a working Turn. An additive
Attempt setup intent defers the Workspace policy to the boundary: changed
command, lockfile, manifest or configuration fingerprints rerun setup, and
MergeConflict forces it. Fingerprints are checked at the boundary, including
changes made after SendBack. Disabled or absent commands skip setup.
Other non-Gate preparation runs the Workspace's
worktree setup on the worker Host before returning the Attempt: auto-detected
lockfile command, disabled, or a custom shell command. It persists a separate
setup card on the Session, so failure is visible even before a first Turn.
A failed setup refuses dispatch and uses the Session machine's failure signal.
Successful command-ID retries reuse the completed setup receipt; a failure may
be retried. No worker slot is acquired and Attempt working time has not begun
during initial setup. Deferred retry setup runs in the acquired worker scope
and closes it on failure, before any startup receipt or brief. Remote placement carries the owning Workspace's setting. The final runtime wraps deferred handover,
local working scopes and real Git Claim/Accept checks. Remote mirrors use their
own scoped worker hooks. Both start callbacks run after resource acquisition;
A per-Session input gate prioritizes a missing startup receipt and holds
readiness, setup, retirement, commit and Harness submission together. Queued
Lead inputs and user steering follow the brief; a queued user SendTurn follows
the brief's boundary. Duplicate startup checks the receipt before retirement.
Remote assignment changes wake input waiters without polling. Existing Sessions wait for machine readiness rather than bypassing approvals
or terminal ownership. First Turn/title commits have stable Attempt IDs.

Startup mounts one loopback MCP listener, installs the local/remote command
facade, replays token revocation, resumes local and remote working scopes, and
starts delivery plus durable remote ack replay. Resume submits a first Turn only
when the persisted startup command receipt is absent, including Initial Attempts.
The receipt survives the bounded recent-Turn projection. Pending first startup
accepts a restart-interrupted Needs You Session with no pending input through the
Session machine, using its acquired slot. Local and remote
startup must still be the latest working Attempt; remote startup rechecks the durable
assignment. An ineligible startup never writes a successful empty receipt.
An eligible local interruption invokes the one Continue inside the acquired resume hook. Remote recovery remains blocked until verified worker
interruption/continued-Turn facts are available.

Every Harness open derives current role attachments from folded local graphs
or durable remote assignments. Gate Sessions have separate Lead and Worker MCP
servers. Claude tools and Codex URLs remain Session-scoped; trusted worker
environment variables are passed through SDK env or per-thread app-server
config, without editing user config files. The normalized Harness event drain
calls the liveness producer; queued delivery changes update queued input.

Handover stops an active Gate in the same journal batch as LeadChanged. Its
receipts appear in the new Lead's header. The next Gate Attempt is Superseded
with a backward reference; other workers keep their assignments.

`constellation.connection` accepts authenticated Client observations only.
The existing Client relay sends actual Offline/Connected Connection State,
replays facts after owner reconnect or a new Attempt, and retries failed sends
on existing event-driven relay wakes. There is no connection polling or idle
Constellation timer. Unknown Hosts remain unobserved rather than inferred stale.

Worker preparation validates inherited Claude `auto` permissions against the
running binary's model metadata before registering a new Session or committing
an Attempt. Unsupported or unverified capabilities return
`E-HARNESS-PERMISSIONS` with a model/mode repair through the dispatch result and
Client error. The probe sends no Turn and persists no Claude Session; setup and
slot acquisition follow it. Existing placements validate their own Session
selection. The live driver also guards resume, model changes and SDK fallback.

The first interactive Codex/Claude Session open also activates the cached layer. Empty startup and read-only Session opens retain the no-op boundary. Unassigned Sessions receive a Plain binding with a reserved graph ID and current Workspace ID; `plan.start` journals ownership before Lead commands can act. Start/resume rebuilds attachments from the current fold. Archive/handover revocation still applies to these tokens.
