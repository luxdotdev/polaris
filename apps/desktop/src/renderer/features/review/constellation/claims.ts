/**
 * Review's "Workers' claims" (Paper C4): worker sessions whose latest Attempt is in review,
 * across every Constellation; every worker session leaves "Agent sessions ready", since the
 * Lead, not the session Accept, takes a worker's work. Pure, so it is tested.
 */
import type { HostView } from "../../../../shared/api.ts";
import type { HostModel } from "../../../store/hostModel.ts";
import { lookupIn, workerRows } from "../../sessions/model/leadGroups.ts";
import type { ConstellationView } from "../../sessions/source.ts";
import type { QueueSession } from "../model/queue.ts";

export interface WorkerQueue {
  readonly claims: ReadonlyArray<QueueSession>;
  /** `hostKey:sessionId` of every worker session. */
  readonly workers: ReadonlySet<string>;
}

export const workerQueue = (
  views: Readonly<Record<string, ReadonlyArray<ConstellationView>>>,
  hosts: ReadonlyArray<HostView>,
  models: Readonly<Record<string, HostModel>>
): WorkerQueue => {
  const lookup = lookupIn(hosts, models);
  const claims: Array<QueueSession> = [];
  const workers = new Set<string>();

  for (const view of Object.values(views).flat()) {
    if (view.constellation.state === "archived") continue;

    for (const row of workerRows(view, lookup)) {
      if (row.hostKey === null) continue;
      const id = `${row.hostKey}:${row.sessionId}`;

      workers.add(id);

      if (row.state === "review")
        claims.push({
          kind: "session",
          id,
          hostKey: row.hostKey,
          sessionId: row.sessionId,
          harness: row.entry?.session.harness ?? "codex",
          title: `${row.taskId} · ${row.title}`,
          meta: `Claim · ${view.constellation.name}`,
        });
    }
  }

  return { claims, workers };
};
