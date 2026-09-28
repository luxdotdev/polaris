# Event store and orchestration engine

`store/` persists; `engine/` decides and supervises. Decisions: Linear ENG-175 (event-sourced SQLite) and ENG-176 (orchestration). The design follows pingdotgg/t3code@de251fc (MIT) `docs/internals/overview.md`; no code was copied.

## Store (`store/`)

- `migrations.ts`: one SQLite database (`paths().database`) migrated with the Effect SQL migrator. `events` holds every `DomainEvent` with a global, gapless `sequence`, its stream (`host` or `session` + `session_id`), `command_id`, `occurred_at` and the JSON payload. `command_receipts` makes retries idempotent. `workspaces`, `worktrees`, `sessions`, `turns`, `turn_items` and `pending_approvals` are projections.
- `model.ts`: the read model and its reducer (`project`), a pure fold over envelopes. The decider validates against it and snapshots are built from it. Turn items are the exception: they live only in SQL.
- `EventStore.ts`: `commit({ commandId, decide })` runs under a single permit: check the receipt, `decide` against the latest model, write events + projections + receipt in **one transaction**, swap the model, and only then publish to subscribers. A seen `commandId` returns `Duplicate` with the original sequence, or re-fails with the original rejection (rejections get receipts too). `readEvents` / `readTurnItems` serve replay and snapshots.

## Engine (`engine/`)

- `decider.ts`: a pure decider for every `Command`. Examples: no `SendTurn` while a Turn is in flight, `Continue` only for an Interrupted Turn, `RespondToApproval` for a resolved request is rejected (first Client wins; `ApprovalResolved.resolvedBy` is that device's label).
- `Engine.ts`:
  - `dispatch`: resolves attachments and probes paths up front, commits, acks ("intent recorded"), then forks the **reactor** (after commit, serialized per session).
  - The supervisor opens Harnesses through `HarnessRegistry` with `resumeCursor` and maps `HarnessEvent`s to domain events and Session State changes: Starting → Working → Needs You → Working → Idle; a Harness that exits with an error → Failed. It captures `before`/`after` checkpoints per Turn, creates `NewWorktree` placements at `<worktreeRoot>/<branch>`, and stops Idle Harnesses after `EngineConfig.idleTimeout` (30 min) → Dormant. The next Turn resumes from the cursor. `OpenInTerminal` closes Claude's Harness (`liveCoAttach: false`) and keeps Codex attached. `ArchiveSession` removes the Worktree the session created (the branch stays) and calls `AttachmentStore.onSessionArchived`.
  - Recovery on start: a `working` Turn becomes `interrupted` and its session moves to Needs You (reason `interrupted`, so the Client offers Continue). Pending approvals are withdrawn. Other live states go Dormant, and Failed stays Failed. A Turn is never continued automatically.
  - Streams: subscribe to the live hub first, then read the model's sequence as the cut. With `afterSequence` null (or ahead of the cut), the stream sends a snapshot; otherwise it replays `(afterSequence, cut]` from the `events` table. Then `Synchronized`, then live events with `sequence > cut`. The result has no gaps and no duplicates. The Host stream omits `TurnItemCompleted` and `CheckpointRecorded`. `Delta`s are live-only, on session streams.
- `rpc.ts`: `EngineRpcHandlers`, a layer of `DaemonRpcs.toLayerHandler` for `dispatch`, `subscribeHost` and `subscribeSession`. The transport provides it to `RpcServer.layer(DaemonRpcs)` with the other modules' handlers. Its `hello` handler must call `options.client.annotate(DeviceLabel, payload.deviceLabel)`.
- `testing.ts`: a scriptable fake `HarnessDriver` and fake Checkpoints / WorktreeTracker / AttachmentStore layers.

Wiring: `Engine.layer` needs `EventStore` (`EventStore.layerLive`), `HarnessRegistry`, `Checkpoints`, `WorktreeTracker` and `AttachmentStore`.

## Known gaps / TODOs

- **Fork git side**: `ForkSession` records the parent link and starts Dormant in the parent's cwd. It doesn't yet create a Worktree at the Turn's checkpoint.
- **Unarchive** does not recreate a removed Worktree; the session's cwd may no longer exist.
- `ApprovalWithdrawn` and restart-withdrawn requests are recorded as `ApprovalResolved` with a `Deny` decision and `resolvedBy` `"Harness"` / `"Daemon"`. A dedicated event would be clearer.
- `terminalCommand(sessionId)` exposes the Harness TUI argv, but no RPC carries it to Clients yet.
- In Terminal: Claude may write a new session id from its TUI. The cursor is not refreshed on `ReturnFromTerminal`.
- The live hub is unbounded. A stalled subscriber grows memory until its stream is closed.
- The read model keeps all Turns (not items) in memory. Snapshots page Turns with `turnLimit`, but replay reads a whole range at once.
- `Steer`, `Interrupt`, `RespondToApproval` and `SetPermissionMode` reach the Harness only while it runs. Otherwise they are logged.
