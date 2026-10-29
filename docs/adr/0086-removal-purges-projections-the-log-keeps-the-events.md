---
status: accepted
implements: ENG-566 (permanently remove an archived workspace)
---

# Removing a Workspace purges the projections; the log keeps the events

## Context

Hidden ("archived") Workspaces stayed in Settings forever. The owner wants a destructive Remove
for one, and decided (ENG-566, 2026-10-29) that Remove means purge: the Workspace, its settings,
its Agent Sessions (Turns, items, Subagents, approvals, attachments, checkpoints) and its
Constellations disappear from everything a user can see or search. The folder on disk is never
touched.

`RemoveWorkspace` already existed. Its decider refuses unless every session of the Workspace is
Archived and records `WorkspaceRemoved`; the projection dropped only the Workspace and its
Worktrees, so its sessions stayed in the read model, the Host feed and history search, pointing
at a Workspace that no longer existed.

The `events` table is append-only with a global, gapless sequence (`apps/daemon/src/store/README.md`;
`gaplessLog` in `packages/spec/polaris.qnt`). Feeds resume by sequence and the model-based tests
and trace validation compare Client feeds against it, so deleting the Workspace's events would
break the store's central guarantee and every resume across the removal.

## Decision

Removal is one more event, and every projection applies it. Nothing is deleted from `events`.

- The read model (`store/removal.ts`, `purgeWorkspace`) drops the Workspace, its Worktrees, its
  sessions and its Constellations when it folds `WorkspaceRemoved`. Review Checkouts end through
  their own lifecycle (the reactor removes them as before).
- The projection (`purgeWorkspaceRows` in `store/projection.ts`) deletes the Workspace's rows
  from `workspaces`, `worktrees` and `sessions`, and its sessions' rows from `turns`,
  `turn_items`, `pending_approvals`, `subagents`, `session_reads` and `session_drafts`, in the
  same transaction as the event.
- Constellations are folded from the log on every start (`loadModel`), so that fold reads
  `WorkspaceRemoved` too and drops them again. A replay of the whole log through `project`
  reaches the same purged model.
- Everything built on the model follows: Host snapshots, session lookups, history search
  (`mcp/sessions/history.ts` reads the model and the `turns` / `turn_items` tables), recovery,
  checkpoint sweeps. Clients folding a live `WorkspaceRemoved` drop the Workspace's sessions and
  Constellations themselves.
- The reactor deletes the Polaris-held side data: the sessions' checkpoint refs (as before, now
  found in the model before the removal), the Review Checkouts, the staged attachments and the
  Workspace's attachment-cleanup override (`AttachmentStore.onWorkspaceRemoved`). The Desktop
  App drops its own per-Workspace overrides and the Host's Reviewer override after a removal.
- A purged session's id is NotFound to every command afterwards, so the removal is final.
  Workspace ids are never reused (a re-added folder gets a new one).
- The decider still refuses while a session isn't Archived. The Desktop App says so rather than
  archiving them as part of Remove: Archive has per-session effects (it removes the worktree a
  session created, stops its Harness, is refused mid-Turn), and folding several of them into one
  confirmation would hide those effects and could stop halfway.

## Consequences

- The raw text of a removed Workspace's sessions stays in the `events` table on its Host. Remove
  hides it from Polaris; it does not erase it from the disk. A future "erase" would have to
  compact the log and is a separate decision.
- `packages/spec/polaris.qnt` models the removal (`RemoveWorkspace`, `WorkspaceRemoved`,
  `removalNeedsArchived`, `removalIsFinal`, the `removal` instance).
