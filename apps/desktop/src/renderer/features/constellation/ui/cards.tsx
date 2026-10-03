/**
 * Polaris-authored cards (DESIGN.md): what Polaris puts into a Turn is a row-radius card on
 * surface-raised with the Constellation mark, never the user's prompt bubble.
 */
import type { AttemptState } from "@polaris/protocol";
import { ChevronRightIcon, cn } from "@polaris/ui";
import { Match } from "effect";
import type { ReactNode } from "react";
import {
  type AttemptData,
  claimGlance,
  clock,
  type ConstellationRecord,
  type Digest,
  type Facts,
  LANE_MAX,
  laneWidth,
  type NotificationData,
  pluralize,
  shortSha,
  type TaskData,
  type TaskGlyphKind,
} from "../model/index.ts";
import { ConstellationMark, TaskGlyph } from "./glyphs.tsx";
import { IdLane, LaneSpacer, laneStyle } from "./lane.tsx";
import { Checks } from "./strip.tsx";

const CARD = "rounded-row border-hairline bg-surface-raised border";

const CardHead = ({ title, aside }: { readonly title: ReactNode; readonly aside?: ReactNode }) => (
  <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
    <ConstellationMark size={14} />
    <span className="text-label text-text-strong min-w-0 truncate">{title}</span>
    <span className="flex-1" />
    {aside === undefined ? null : (
      <span className="text-caption text-text-subtle shrink-0">{aside}</span>
    )}
  </div>
);

const Fact = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="flex gap-3">
    <dt className="text-caption text-text-subtle w-14 shrink-0 leading-5">{label}</dt>
    <dd className="text-body text-text-default min-w-0 leading-5">{children}</dd>
  </div>
);

export interface BriefCardProps {
  readonly leadTitle: string;
  readonly task: TaskData;
  readonly attempt: AttemptData;
  /** Accepted deps, for "After". */
  readonly accepted: ReadonlyArray<string>;
  readonly folded: boolean;
  readonly onToggle: () => void;
}

/** A worker's brief: "Brief from {lead}", the Task, Area, branch and base, accepted deps, text. */
export const BriefCard = ({
  leadTitle,
  task,
  attempt,
  accepted,
  folded,
  onToggle,
}: BriefCardProps) => {
  const area = task.area.join(", ");

  if (folded)
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn(CARD, "flex h-10 w-full cursor-default items-center gap-2 px-3.5 text-left")}
        data-testid="brief-card"
      >
        <ConstellationMark size={14} />
        <span className="text-label text-text-strong shrink-0">Brief from {leadTitle}</span>
        <span className="text-caption text-text-subtle min-w-0 truncate">
          · Task {task.id}
          {area === "" ? "" : ` · ${area}`}
        </span>
        <span className="flex-1" />
        <ChevronRightIcon size={10} className="text-text-faint" />
      </button>
    );

  return (
    <div className={CARD} data-testid="brief-card">
      <CardHead title={`Brief from ${leadTitle}`} aside={`Task ${task.id}`} />
      <dl className="flex flex-col gap-0.5 px-3.5 pb-2">
        {area === "" ? null : (
          <Fact label="Area">
            <span className="text-code-inline font-mono">{area}</span>
          </Fact>
        )}
        <Fact label="Branch">
          <span className="text-code-inline font-mono">
            {attempt.branch} ← {shortSha(attempt.base)}
          </span>
        </Fact>
        {accepted.length === 0 ? null : (
          <Fact label="After">
            <span className="flex items-center gap-1.5">
              <span className="bg-accepted size-[7px] rounded-full" />
              {accepted.join(", ")} accepted
            </span>
          </Fact>
        )}
      </dl>
      <p className="text-body text-text-default px-3.5 pb-3.5 whitespace-pre-wrap">{task.brief}</p>
    </div>
  );
};

interface DigestLine {
  readonly key: string;
  readonly task: TaskData | null;
  readonly glyph: Parameters<typeof TaskGlyph>[0]["glyph"];
  readonly tone: string;
  readonly body: ReactNode;
}

const SETTLED_GLYPH: Readonly<Partial<Record<AttemptState, TaskGlyphKind>>> = {
  accepted: "accepted",
  review: "review",
  failed: "failed",
};

const attemptOf = (r: ConstellationRecord, id: string) =>
  r.constellation.attempts.find((a) => a.id === id) ?? null;

const settledLine = (r: ConstellationRecord, attemptId: string, state: string, facts: Facts) => {
  const a = attemptOf(r, attemptId);
  const claim = a?.claim;

  if (state === "review" && claim != null) {
    const g = claimGlance(claim, facts);

    return (
      <>
        claimed{" "}
        <span className="text-code-inline text-text-subtle font-mono">{shortSha(g.head)}</span>
        <Checks checks={g.checks.filter((c) => c.ok === false)} />
        {g.questions === 0 ? null : (
          <span className="text-needs-you-text">{pluralize(g.questions, "question")}</span>
        )}
      </>
    );
  }

  return <>{state === "accepted" ? "accepted" : state.replaceAll("_", " ")}</>;
};

const lineOf = (r: ConstellationRecord, n: NotificationData, facts: Facts): DigestLine => {
  const task = (id: string | null) =>
    r.constellation.tasks.find((t) => t.id === (id === null ? null : attemptOf(r, id)?.taskId)) ??
    null;

  return Match.value(n.item).pipe(
    Match.tagsExhaustive({
      Blocked: ({ attemptId, on, reason }): DigestLine => ({
        key: n.id,
        task: task(attemptId),
        glyph: "waiting",
        tone: "text-text-subtle",
        body: `blocked${on.length === 0 ? " awaiting the lead" : ` by ${on.join(", ")}`}: ${reason}`,
      }),
      Stopped: ({ attemptId }): DigestLine => ({
        key: n.id,
        task: task(attemptId),
        glyph: "stopped",
        tone: "text-text-subtle",
        body: "stopped without claiming",
      }),
      Settled: ({ attemptId, state }): DigestLine => ({
        key: n.id,
        task: task(attemptId),
        glyph: SETTLED_GLYPH[state] ?? "stopped",
        tone: state === "accepted" ? "text-accepted-text" : "text-text-subtle",
        body: settledLine(r, attemptId, state, facts),
      }),
      // The user's verdict isn't accepted work yet (rule/constellation-colour): neutral.
      Approved: ({ attemptId }): DigestLine => ({
        key: n.id,
        task: task(attemptId),
        glyph: "review",
        tone: "text-text-subtle",
        body: "approved by you · the lead merges",
      }),
      Question: ({ attemptId, question }): DigestLine => ({
        key: n.id,
        task: task(attemptId),
        glyph: "needs-you",
        tone: "text-needs-you-text",
        body: <span className="truncate">asks: {question.text}</span>,
      }),
      Proposal: ({ attemptId, proposalId }): DigestLine => ({
        key: n.id,
        task: task(attemptId),
        glyph: "future",
        tone: "text-text-subtle",
        body: `proposed “${r.proposals.find((p) => p.proposalId === proposalId)?.task.title ?? "a task"}”`,
      }),
      OperatorMessage: ({ text }): DigestLine => ({
        key: n.id,
        task: null,
        glyph: "waiting",
        tone: "text-text-subtle",
        body: <span className="truncate">{text}</span>,
      }),
      // An answer isn't accepted work (rule/constellation-colour): a neutral glyph.
      QuestionAnswered: ({ attemptId, text }): DigestLine => ({
        key: n.id,
        task: task(attemptId),
        glyph: "waiting",
        tone: "text-text-subtle",
        body: <span className="truncate">you answered: {text}</span>,
      }),
    })
  );
};

/** A Lead's digest Turn: one row per settle or question, each with its glyph and coloured id. */
export const DigestCard = ({
  record,
  digest,
  facts,
}: {
  readonly record: ConstellationRecord;
  readonly digest: Digest;
  readonly facts: Facts;
}) => {
  const lines = digest.items.map((n) => lineOf(record, n, facts));
  const ids = lines.flatMap((l) => (l.task === null ? [] : [l.task.id]));

  return (
    <div className={CARD} data-testid="digest-card">
      <CardHead
        title={
          <>
            {record.constellation.name}
            <span className="text-text-subtle font-normal">
              {" "}
              · {pluralize(digest.items.length, "update")} for the lead
            </span>
          </>
        }
        aside={clock(digest.at)}
      />
      <ul className="flex flex-col pb-2" style={laneStyle(laneWidth(ids, LANE_MAX.digest))}>
        {lines.map((line) => (
          <li
            key={line.key}
            className="text-body text-text-default flex h-7 items-center gap-3 px-3.5"
          >
            <TaskGlyph glyph={line.glyph} harness={null} size={14} />
            {line.task === null ? (
              <LaneSpacer />
            ) : (
              <IdLane id={line.task.id} max={LANE_MAX.digest} className={line.tone} />
            )}
            <span className="flex min-w-0 items-center gap-2">{line.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
