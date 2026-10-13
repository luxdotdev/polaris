/** F8/F9 on fixtures: a usage-limited and a disconnected worker, and one with no Turn running. */
import { AttemptId, ConstellationNotification, NotificationItem } from "@polaris/protocol";
import type { ConstellationRecord } from "../model/index.ts";
import { attempt, c1Attempts, DEVBOX, slugRecord } from "./graph.ts";

const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

const failed = (taskId: string, failureKind: "capacity" | "transport", resetsAt: string | null) =>
  new ConstellationNotification({
    id: `n-failed-${taskId}`,
    item: NotificationItem.cases.Settled.make({
      attemptId: AttemptId.make(`att-${taskId}-1`),
      state: "failed",
      failureKind,
      resetsAt,
    }),
    queuedAt: ahead(-2),
  });

export const failuresRecord = (): ConstellationRecord => {
  const record = slugRecord({
    attempts: c1Attempts.map((a) => {
      if (a.taskId === "B3")
        return attempt({
          taskId: "B3",
          state: "failed",
          minutes: 40,
          failure: {
            kind: "capacity",
            reason: "Selected model is at capacity",
            resetsAt: ahead(95),
          },
        });

      if (a.taskId === "B4")
        return attempt({
          taskId: "B4",
          state: "failed",
          minutes: 52,
          host: DEVBOX,
          failure: { kind: "transport", reason: "stream closed before the turn ended" },
        });

      return a;
    }),
  });

  return {
    ...record,
    digests: record.digests.map((d, n) =>
      n === 0
        ? {
            ...d,
            items: [
              failed("B3", "capacity", ahead(95)),
              failed("B4", "transport", null),
              ...d.items.slice(0, 2),
            ],
          }
        : d
    ),
  };
};

/** B2's Daemon says no Turn is in flight. */
export const FAILURE_SIGNALS = new Map([
  ["att-B2-1", { activeTurn: false, activity: null, quietSince: ahead(-12) }],
]);
