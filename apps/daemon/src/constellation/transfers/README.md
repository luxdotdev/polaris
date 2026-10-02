# Constellation Git and relay composition (C1-W)

The owning Host alone commits graph events. Worker Hosts persist mirrors, Git refs,
Session records and outbound requests. The Desktop App carries bundles and requests
through its existing `HostConnection`s. There is no relay polling or idle timer.

## L startup boundary

1. Build `constellationGitLayer(path)` once per Host. It requires `EventStore` and
   exports `TransferStorage`, `ConstellationWorktrees`, `RemotePlacements` and
   `ConstellationBranchStatus`. Use a Host-private SQLite path; test paths are temporary.
2. Inject `prepareWorkerAttempts(command, model, commandId, hooks)` into
   `ConstellationRuntime.prepare`. `hooks.defaultWorker(graph, task)` chooses a
   `WorkerPlacement`; `hooks.prepareSession(WorkerPreparation)` returns
   `Effect<Attempt, ConstellationRejected, R>`. It allocates/restores Sessions through
   the Session machine without sending a Turn. W supplies the actual worktree,
   branch, resolved base, previous Attempt and stable request key. Remote preparation
   waits for a connected Client. Gate preparation uses the Lead checkout.
3. Build the local `hostWorkingAttemptsLayer` with the injected Session startup and
   resume hooks. It starts only locally owned Attempts after `AttemptStarted` commits.
   Gate startup installs a separate Worker attachment on the existing Lead Session;
   the Lead attachment remains available for review (C1-T contract).
4. Build `remoteWorkingAttemptsLayer({prepare, start, resume, failed})`, providing
   `EventStore`, the same `TransferStorage`, `HostResources`, `McpTokens` and local
   `ConstellationOwner`. Its `prepare(request, prepared)` returns
   `Effect<Attempt, ConstellationTransferError>`. `start(assignment, env)` and
   `resume(assignment, env)` accept `Effect<void, E, R>`. Both run only after the
   worker slot is acquired. `failed(attempt, error)` is the injected failure reactor.
   Working scopes close on locally queued Claims and settled/archive mirrors;
   Review retains the Worker credential, while settlement/archive revokes it.
5. Wrap the final Runtime with `withWorktreePreparation(runtime)`. It supplies actual
   local Git Claim probes and exact fetched/merged Accept checks, preserves preparation
   fields added by L (including deferred handover), and delegates `afterCommit` before
   safe worktree cleanup. Build `constellationRelayLayer` after providing that final
   Runtime and remote worker hooks. It exports `ConstellationOutbox`,
   `RemoteAssignments` and `RemoteDeliveries`. Mount `ConstellationTransferHandlers`
   in L's server composition. Provide `ConstellationTransferRoot` when overriding the
   Host-private managed-repository root.
6. Give H the facade returned by `withRemoteWorkerCommands(localConstellations)`.
   It forwards bound remote worker command/status/resolve calls to their durable
   mirror/outbox; local Sessions use the real Constellations service.
7. At restart: recover Session machines and replay MCP revocation first. Then call
   final `ConstellationRuntime.resumeWorking()` and `RemoteAssignments.resumeWorking()`.
   These reacquire working scopes without a first Turn. Slot acquisition is asynchronous:
   call L's `recoverAttempt(candidate)` from the injected **resume hook**, after the
   slot/leases are held, rather than immediately after `resumeWorking()` returns.

`POLARIS_HOST_SOCKET` and `POLARIS_SESSION_ID` are supplied in the startup environment
by `workerEnvironment`; optional `POLARIS_BINARY` is forwarded. The Session callback
owns title persistence, Harness selection, attachment and first Turn routing.

## Input delivery boundary

Inject `RemoteWorkerDelivery.apply(packet): Effect<void, ConstellationTransferError>`
before building `constellationRelayLayer`. It must atomically apply the pure Session
command and its receipt under `packet.id`; check an existing receipt before current
state checks, and run the Engine reactor only for a newly committed command.
`Turn` input carries `{text,cause}`; `Steer` carries `{text}`. A recovery Turn must use
Continue semantics. W does not authorize recovery from the owner's absent Session log.

`RemoteDeliveries.send(packet)` persists the owner packet and waits for worker ack.
Its `acknowledged` stream initially replays every durable acknowledged packet and
updates after ack. L consumes each with `acknowledge(packet.id, packet.sessionId)`;
L's journal deduplicates it. IDs are per recipient: L uses
`JSON.stringify([sourceMessageId, sessionId])` and maps this back to the source message.

The worker's durable W receipt contains a packet hash, not an interrupted/continued
Turn proof. Remote automatic recovery remains blocked until composition provides
verified worker Turn facts and continued Turn IDs. No owner-side remote Turn is fabricated.

## Git and cleanup

Bundles are self-contained, verified against advertised ref/head, streamed over
BlobChannels and imported only into `refs/polaris/constellations/*`. Claims pin the
worker commit before enqueue. Origin transfer is explicit per Constellation and uses
immutable branches under its prefix; default bundle transfer requires no Git remote.

`ConstellationWorktrees.cleanup(graph, leadPath, candidates, busySessions, mergedRef?)`
and `cleanupConstellationWorktrees(graph, leadPath, mergedRef?)` remove only managed,
registered, clean, merged worktrees after the merging Gate is accepted or on archive.
Active Attempts, busy Sessions and unmerged commits block removal. User worktrees and
branches survive. Remote relay imports the owner's merged head before mirroring the
cleanup boundary; worker cleanup checks that fetched ref without changing its branch.

`BranchFetched` is live, unsequenced and ungated within the Constellation feed. Snapshot
projections hydrate it; Accept checks the actual exact ref and ancestry again. The
renderer applies it only to the latest Attempt.
