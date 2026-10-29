/**
 * Removing a Workspace purges it from the read model: the Workspace, its Worktrees, its
 * Agent Sessions and its Constellations. The `events` log keeps every event
 * (docs/adr/0086-removal-purges-projections-the-log-keeps-the-events.md).
 */
import type { ConstellationId, WorkspaceId } from "@polaris/protocol";
import type { ConstellationRecord } from "./constellation.ts";
import type { ReadModel } from "./model.ts";

const without = <K, V>(map: ReadonlyMap<K, V>, drop: (value: V) => boolean): ReadonlyMap<K, V> => {
  const kept = new Map([...map].filter(([, value]) => !drop(value)));

  return kept.size === map.size ? map : kept;
};

/** The Constellations left once `workspaceId`'s are gone. */
export const withoutConstellationsOf = (
  constellations: ReadonlyMap<ConstellationId, ConstellationRecord>,
  workspaceId: WorkspaceId
) => without(constellations, (record) => record.graph.workspaceId === workspaceId);

/** The model with `workspaceId` and everything in it gone. Review Checkouts end through their own lifecycle. */
export const purgeWorkspace = (model: ReadModel, workspaceId: WorkspaceId): ReadModel => {
  const workspaces = new Map(model.workspaces);

  workspaces.delete(workspaceId);

  return {
    ...model,
    workspaces,
    worktrees: without(model.worktrees, (worktree) => worktree.workspaceId === workspaceId),
    sessions: without(model.sessions, (record) => record.session.workspaceId === workspaceId),
    constellations: withoutConstellationsOf(model.constellations, workspaceId),
  };
};
