import type { SessionId } from "@polaris/protocol";
import type { ConstellationRecord } from "../../store/constellation.ts";
import { notificationLine } from "../delivery/format.ts";
import { statusOutline } from "../status.ts";

/** This structured header comes from the folded log even when the old Harness cannot summarize. */
export const handoverHeader = (record: ConstellationRecord, to: SessionId, summary: string) =>
  [
    `Polaris handover · ${record.graph.name} · revision ${record.graph.revision}`,
    `You are the new Lead (${to}), replacing ${record.graph.leadSessionId}. Existing workers continue their Attempts.`,
    statusOutline(record),
    "Claims awaiting review:",
    ...record.graph.attempts.flatMap((a) =>
      a.state === "review" ? [`${a.taskId} · ${a.id}: ${JSON.stringify(a.claim)}`] : []
    ),
    "Open questions:",
    ...[...record.questions.values()].flatMap((q) =>
      q.answer === null ? [`${q.attemptId}: ${JSON.stringify(q.question)}`] : []
    ),
    "Queued digest items (still queued):",
    ...record.graph.pendingNotifications.map((n) => `${n.id}: ${notificationLine(record, n)}`),
    "Every message in transit:",
    ...[...record.messages.values()].map((m) =>
      JSON.stringify({ ...m, recipients: record.messageTargets.get(m.id) ?? [] })
    ),
    ...[...record.peers].map(([id, m]) => JSON.stringify({ id, ...m })),
    `Settings: ${JSON.stringify(record.graph.settings)}`,
    summary === ""
      ? "The previous Lead could not provide a summary. Continue from the recorded facts above."
      : `Previous Lead's summary:\n${summary}`,
    "Next: read status, review pending Claims and answer open questions. Resume oversight without restarting existing workers.",
  ].join("\n");
