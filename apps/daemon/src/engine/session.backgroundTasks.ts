import { DomainEvent, type BackgroundTask } from "@polaris/protocol";
import { endBackgroundWork } from "./session.subagents.ts";
import type { Emitted, SessionInput } from "./session.inputs.ts";
import type { SessionRecord } from "../store/model.ts";

export const waitingOnBackgroundWork = (record: SessionRecord): boolean =>
  record.subagents.size > 0 || record.session.backgroundTasks.length > 0;

export const backgroundTasksChanged = (
  record: SessionRecord,
  tasks: ReadonlyArray<BackgroundTask>
) => [
  DomainEvent.cases.SessionBackgroundTasksChanged.make({ sessionId: record.session.id, tasks }),
];

export const idleStopEffect = (record: SessionRecord): Emitted[] =>
  record.session.state === "idle" ? [{ type: "effect", effect: "scheduleIdleStop" }] : [];

export const backgroundIdleStop = (
  record: SessionRecord,
  event: Extract<SessionInput, { type: "idle.timeout" }>
) =>
  !event.harnessLive || (waitingOnBackgroundWork(record) && event.backgroundExpired !== true)
    ? null
    : {
        events:
          event.backgroundExpired === true
            ? endBackgroundWork(record, event.at ?? record.session.updatedAt)
            : [],
        reason: event.backgroundExpired === true ? "background-idle-timeout" : "idle-timeout",
      };
