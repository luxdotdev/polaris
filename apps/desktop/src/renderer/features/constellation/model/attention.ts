/**
 * The header's needs-you chip and "next that needs you" (tab): the top item in Needs you's
 * order (spec §5), then Tasks in declaration order.
 */
import { CONTEXT_WARN, type Facts } from "./facts.ts";
import { setupOutcome } from "./setup.ts";
import type { TaskRow } from "./task.ts";

export interface AttentionItem {
  readonly taskId: string | null;
  readonly text: string;
  /** Lower ranks first. */
  readonly rank: number;
}

const itemFor = (row: TaskRow, facts: Facts): AttentionItem | null => {
  const id = row.task.id;
  const { attention } = row.look;

  if (attention !== null) {
    switch (attention.kind) {
      case "approval":
        return { taskId: id, text: `${id} waiting on your approval`, rank: 1 };
      case "question":
        return { taskId: id, text: `${id} asks you`, rank: 2 };
      case "handed":
        return { taskId: id, text: `${id}'s claim handed to you`, rank: 3 };
      case "stopped":
        return { taskId: id, text: `${id} stopped without claiming`, rank: 4 };
      case "setup":
        return { taskId: id, text: `${id} setup failed · ${setupOutcome(attention.run)}`, rank: 4 };
    }
  }

  if (
    row.attempt === null ||
    (row.projection.state !== "working" && row.projection.state !== "review")
  )
    return null;
  const worker = facts.worker(row.attempt);

  if (worker.hostAway === "offline" || row.projection.stale)
    return { taskId: id, text: `${id}'s host is offline`, rank: 5 };

  if (row.projection.state === "working" && (worker.contextPercent ?? 0) >= CONTEXT_WARN)
    return { taskId: id, text: `${id} at ${worker.contextPercent}% context`, rank: 6 };

  return null;
};

/** Everything in the Constellation that needs you, most urgent first. */
export const attentionItems = (
  rows: ReadonlyArray<TaskRow>,
  facts: Facts
): ReadonlyArray<AttentionItem> => {
  const items = rows.flatMap((row) => {
    const item = itemFor(row, facts);

    return item === null ? [] : [item];
  });

  const lead = facts.lead.contextPercent;

  const leadItem: ReadonlyArray<AttentionItem> =
    lead !== null && lead >= CONTEXT_WARN
      ? [{ taskId: null, text: `Lead at ${lead}% context · hand over`, rank: 7 }]
      : [];

  return [...items, ...leadItem].toSorted((a, b) => a.rank - b.rank);
};

/** The Task after `current` among those that need you, wrapping around. */
export const nextNeedingYou = (
  items: ReadonlyArray<AttentionItem>,
  current: string | null
): string | null => {
  const ids = items.flatMap((i) => (i.taskId === null ? [] : [i.taskId]));

  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);

  return ids[(at + 1) % ids.length] ?? null;
};
