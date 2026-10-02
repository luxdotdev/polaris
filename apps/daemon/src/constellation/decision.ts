import {
  ConstellationEvent,
  ConstellationFinding,
  ConstellationGraphSlice,
  ConstellationNotification,
  ConstellationRejected,
  type NotificationItem,
} from "@polaris/protocol";
import type { ConstellationContext } from "../engine/constellation.inputs.ts";
import { foldConstellation, type ConstellationRecord } from "../store/constellation.ts";
import { projectTasks } from "./projections.ts";

export const finding = (code: string, message: string, fix: string) =>
  new ConstellationFinding({ code, message, fix });

export class GraphDecision {
  readonly events: Array<ConstellationEvent> = [];
  readonly findings: Array<ConstellationFinding> = [];
  constructor(
    public record: ConstellationRecord,
    readonly ctx: ConstellationContext
  ) {}
  fields() {
    return { constellationId: this.record.graph.id, revision: this.record.graph.revision + 1 };
  }
  emit(event: ConstellationEvent) {
    this.events.push(event);
    this.record = foldConstellation(this.record, event, this.ctx.now) ?? this.record;
  }
  reject(code: string, message: string, fix: string) {
    this.findings.push(finding(code, message, fix));
  }
  notify(item: NotificationItem) {
    const fields = this.fields();
    this.emit(
      ConstellationEvent.cases.NotificationQueued.make({
        ...fields,
        notification: new ConstellationNotification({
          id: `${fields.constellationId}:${fields.revision}`,
          item,
          queuedAt: this.ctx.now,
        }),
      })
    );
  }
}

export const refusal = (
  record: ConstellationRecord | undefined,
  findings: ReadonlyArray<ConstellationFinding>
) =>
  new ConstellationRejected({
    findings: [...findings],
    revision: record?.graph.revision ?? 0,
    graph:
      record === undefined
        ? null
        : new ConstellationGraphSlice({
            constellationId: record.graph.id,
            revision: record.graph.revision,
            tasks: record.graph.tasks,
            attempts: record.graph.attempts,
            projections: projectTasks(record),
          }),
  });
