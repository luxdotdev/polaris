/**
 * The handover summary (C9): the previous Lead's prose (the /handoff shape) in a card, then
 * the structured part from the event log as it stood at the switch.
 */
import { Match, Predicate } from "effect";
import type { TaskState } from "@polaris/protocol";
import { PixelHandIcon } from "@polaris/ui";
import { useShellActions } from "../../../shell/hooks.ts";
import {
  clock,
  type ConstellationRecord,
  type Facts,
  glyphFor,
  type Handover,
  type OperatorMessage,
  pluralize,
  type Segment,
  type StripTone,
  type TaskData,
} from "../model/index.ts";
import { ConstellationMark, TaskGlyph } from "./glyphs.tsx";
import { ProgressStrip } from "./strip.tsx";

const SECTION = "text-caption text-text-subtle pt-4 pb-1.5";

const targetOf = (m: OperatorMessage, record: ConstellationRecord) =>
  Match.value(m.target).pipe(
    Match.tagsExhaustive({
      Lead: () => "lead",
      All: () => "all",
      Worker: ({ attemptId }) =>
        record.constellation.attempts.find((a) => a.id === attemptId)?.taskId ?? "worker",
    })
  );

const counts = (h: Handover) => {
  const done = h.projections.filter((p) => p.state === "done").length;
  const review = h.projections.filter((p) => p.state === "review").length;
  const working = h.projections.filter((p) => p.state === "working").length;
  const more = h.projections.length - done - review - working;

  return { done, review, working, more };
};

const TONE: Partial<Record<TaskState, StripTone>> = {
  done: "accepted",
  working: "working",
  review: "review",
  future: "future",
  failed: "failed",
};

const stripOf = (h: Handover, tasks: ReadonlyMap<string, TaskData>): ReadonlyArray<Segment> =>
  h.projections.map((p) => ({
    key: p.taskId,
    tone: TONE[p.state] ?? "waiting",
    harness: tasks.get(p.taskId)?.suggested?.harness ?? null,
  }));

export const HandoverBody = ({
  leadHostKey,
  record,
  handover,
}: {
  readonly leadHostKey: string;
  readonly record: ConstellationRecord;
  readonly handover: Handover;
  readonly facts: Facts;
}) => {
  const { selectSession } = useShellActions();
  const tasks = new Map(record.constellation.tasks.map((t) => [t.id, t]));
  const n = counts(handover);

  const inFlight = handover.inFlight.flatMap((id) => {
    const projection = handover.projections.find((p) => p.latestAttemptId === id);

    return projection === undefined
      ? []
      : [{ id, taskId: projection.taskId, state: projection.state }];
  });

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-5 py-5 select-text"
      data-testid="handover-summary"
    >
      <div className="rounded-row border-hairline bg-surface-raised border px-3.5 py-3">
        <p className="flex items-center gap-2 pb-2">
          <ConstellationMark size={14} />
          <span className="text-label text-text-strong">From the previous lead</span>
          <span className="text-caption text-text-subtle">· /handoff</span>
        </p>
        <p className="text-body text-text-default whitespace-pre-wrap">
          {handover.summary === ""
            ? "The previous lead wrote no summary; the header below carried the work."
            : handover.summary}
        </p>
      </div>
      <p className="text-body flex flex-wrap items-center gap-2 pt-4">
        <span className="text-text-subtle">At {clock(handover.at)}</span>
        <ProgressStrip segments={stripOf(handover, tasks)} />
        <span className="text-accepted-text">{n.done} done</span>
        <span className="text-text-subtle">
          {n.review} review · {n.working} working · {n.more} more
        </span>
      </p>
      {inFlight.length === 0 ? null : (
        <>
          <h3 className={SECTION}>In flight</h3>
          <ul>
            {inFlight.map((a) => {
              const task = tasks.get(a.taskId);

              return (
                <li key={a.id} className="text-body flex h-8 items-center gap-3">
                  <TaskGlyph
                    glyph={glyphFor(
                      { state: a.state === "review" ? "review" : "working", branchFetched: true },
                      { needsYou: false, isGate: false }
                    )}
                    harness={task?.suggested?.harness ?? null}
                  />
                  <span className="text-code-inline text-text-subtle w-8 font-mono">
                    {a.taskId}
                  </span>
                  <span className="text-text-default min-w-0 flex-1 truncate">{task?.title}</span>
                  <span className="text-text-subtle">
                    {a.state === "review" ? "claim in review" : "working"}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {handover.questions.length === 0 ? null : (
        <>
          <h3 className={SECTION}>Open questions</h3>
          {handover.questions.map((q) =>
            Predicate.isTagged(q.item, "Question") ? (
              <p key={q.id} className="text-body text-needs-you-text flex items-center gap-2 py-1">
                <PixelHandIcon size={12} className="text-needs-you shrink-0" />
                {q.item.question.text}
              </p>
            ) : null
          )}
        </>
      )}
      {handover.undelivered.length === 0 ? null : (
        <>
          <h3 className={SECTION}>Not yet delivered</h3>
          {handover.undelivered.map((m) => (
            <p key={m.id} className="text-body text-text-default py-1">
              <span className="text-text-subtle">→ {targetOf(m, record)}</span> “{m.text}” · sent
              with the new lead's first turn
            </p>
          ))}
        </>
      )}
      <p className="text-body flex items-center gap-3 pt-5">
        <button
          type="button"
          className="text-text-strong cursor-default"
          onClick={() => selectSession({ hostKey: leadHostKey, sessionId: handover.from })}
        >
          Open the previous lead ↗
        </button>
        <span className="text-text-subtle">
          archived · read-only · {pluralize(record.handovers.length, "handover")}
        </span>
      </p>
    </div>
  );
};
