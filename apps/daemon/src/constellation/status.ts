import type { Task, Attempt } from "@polaris/protocol";
import type { SessionRecord } from "../store/model.ts";
import type { ConstellationRecord } from "../store/constellation.ts";
import { childTasks, isParent } from "./parents.ts";
import { activeAttempt, latestAttempt, projectTask } from "./projections.ts";

const prefix = (glob: string) => glob.split(/[?*[{]/, 1)[0] ?? "";

export const areaWarnings = (record: ConstellationRecord): ReadonlyArray<string> => {
  const working = record.graph.tasks.filter(
    (task) => latestAttempt(record.graph, task.id)?.state === "working"
  );

  const warnings: Array<string> = [];

  for (const [i, task] of working.entries())
    for (const peer of working.slice(i + 1)) {
      if (
        task.area.some((a) =>
          peer.area.some((b) => prefix(a).startsWith(prefix(b)) || prefix(b).startsWith(prefix(a)))
        )
      )
        warnings.push(`${task.id} and ${peer.id} may share an area`);
    }

  return warnings;
};

const reviewLines = (attempt: Attempt, session?: SessionRecord): ReadonlyArray<string> => {
  const lines: Array<string> = [];

  if (attempt.approvedByUserAt !== null) lines.push("  Approved by the user · awaiting merge.");

  if (attempt.handedUpAt !== null)
    lines.push(
      `  Handed up to the user${attempt.handedUpReason === null ? "" : `: ${attempt.handedUpReason}`}`
    );

  if (
    attempt.state === "working" &&
    attempt.nudgedAt !== null &&
    session !== undefined &&
    (session.session.state === "idle" || session.session.state === "dormant") &&
    session.session.updatedAt > attempt.nudgedAt
  )
    lines.push("  Stopped without claiming · nudged once.");

  if (attempt.state === "blocked")
    lines.push(
      `  blocked${attempt.blockedOn.length === 0 ? " awaiting the Lead" : ` by ${attempt.blockedOn.join(", ")}`}: ${attempt.blockedReason}`
    );

  return lines;
};

const taskLines = (
  record: ConstellationRecord,
  task: Task,
  sessions?: ReadonlyMap<Attempt["sessionId"], SessionRecord>
): ReadonlyArray<string> => {
  const graph = record.graph;
  const lines: Array<string> = [];
  const projection = projectTask(record, task);
  const attempt = latestAttempt(graph, task.id);
  lines.push(
    `${task.id} · ${task.title} · ${task.kind} · ${projection.state} · task revision ${task.revision}${projection.blockedBy.length === 0 ? "" : ` · waiting on ${projection.blockedBy.join(", ")}`}`
  );

  if (attempt !== undefined) {
    lines.push(
      `  ${attempt.id} · attempt revision ${attempt.revision} · ${attempt.sessionId} · ${attempt.branch}${projection.stale ? " · host offline" : ""}`
    );

    lines.push(...reviewLines(attempt, sessions?.get(attempt.sessionId)));

    if (attempt.claim !== null && attempt.state === "review")
      lines.push(
        `  Claim ${attempt.claim.head} · ${attempt.claim.receipts.length} receipts · ${attempt.claim.notDone.length} not done${projection.branchFetched ? "" : " · branch not yet fetched"}: ${attempt.claim.summary}`
      );
  }

  return lines;
};

const treeLines = (
  record: ConstellationRecord,
  sessions?: ReadonlyMap<Attempt["sessionId"], SessionRecord>
): ReadonlyArray<string> => {
  const lines: Array<string> = [];
  const roots = record.graph.tasks.filter((task) => task.parent === null);
  const groups = [...new Set(roots.map((task) => task.group))];

  const append = (task: Task, depth: number) => {
    lines.push(...taskLines(record, task, sessions).map((line) => `${"  ".repeat(depth)}${line}`));

    for (const child of childTasks(record.graph.tasks, task.id)) append(child, depth + 1);
  };

  for (const group of groups) {
    if (group !== null) lines.push(group);

    for (const root of roots.filter((task) => task.group === group))
      append(root, group === null ? 0 : 1);
  }

  return lines;
};

/** A stable, readable outline, computed only when requested. */
export const statusOutline = (
  record: ConstellationRecord,
  sessions?: ReadonlyMap<Attempt["sessionId"], SessionRecord>
): string => {
  const { graph } = record;

  const lines = [
    `${graph.name} · ${graph.state} · revision ${graph.revision}`,
    `Lead: ${graph.leadSessionId}`,
  ];

  lines.push(...treeLines(record, sessions));

  if (graph.tasks.length === 0) lines.push("No tasks yet.");

  for (const { attemptId, question, answer } of record.questions.values())
    if (answer === null)
      lines.push(
        `Question ${question.id} · ${attemptId} · to ${question.to}${question.blocking ? " · blocking" : ""}: ${question.text}`
      );

  for (const [id, proposal] of record.proposals)
    lines.push(`Proposal ${id} · ${proposal.task.id} · by ${proposal.by}: ${proposal.task.title}`);

  if (record.handoverRequest !== null)
    lines.push(
      `Handover queued · ${record.handoverRequest.requestId} · waiting for the Turn boundary`
    );

  for (const message of record.messages.values())
    lines.push(`Message ${message.id} · ${message.authority} · in transit: ${message.text}`);
  lines.push(...areaWarnings(record).map((warning) => `Area: ${warning}`));

  const ready = graph.tasks
    .filter((task) => !isParent(graph, task.id) && projectTask(record, task).state === "ready")
    .map((task) => task.id);

  lines.push(`Ready: ${ready.length > 0 ? ready.join(", ") : "none"}`);
  lines.push(`Lead updates queued: ${graph.pendingNotifications.length}`);

  if (
    graph.tasks.length > 0 &&
    graph.tasks.every((task) => task.canceled || projectTask(record, task).state === "done") &&
    !graph.attempts.some(activeAttempt)
  )
    lines.push("All tasks are done. The lead or user can complete the constellation.");

  return lines.join("\n");
};
