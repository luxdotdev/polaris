/**
 * The conversation's row kinds: a folded Turn, the user's prompt, an agent
 * item (the first one carries the Harness avatar), an inline approval or
 * question, how an interrupted or failed Turn ended, and background waits.
 */
import type { ApprovalDecision, ApprovalRequest, SessionId, SessionState } from "@polaris/protocol";
import {
  ApprovalCard,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  cn,
  type Harness,
  harnessHue,
  HarnessMark,
  PixelFailedIcon,
  PixelHandIcon,
  QuestionCard,
  Tile,
} from "@polaris/ui";
import { age } from "../../../shell/copy.ts";
import { SentAttachments } from "../../attachments/index.ts";
import { useNow } from "../../../shell/useNow.ts";
import { Decisions } from "../../../commands.ts";
import { type Row, turnTime } from "../model/conversation.ts";
import { totals } from "../model/diff.ts";
import { plural } from "../model/format.ts";
import { useTurnDiff } from "../turnDiff.ts";
import { questionAnswers } from "../model/question.ts";
import type { OutboxActions } from "../outbox.ts";
import type { Entry } from "../model/runs.ts";
import { Trigger, Waiting } from "./background.tsx";
import { SetupCard } from "./SetupCard.tsx";
import { EntryView } from "./entries.tsx";
import { OutgoingMessage, Steered } from "./outgoing.tsx";
import { softWrap } from "./softWrap.tsx";
import type { SessionChrome } from "../chrome.ts";

export interface RowContext {
  readonly harness: Harness | null;
  readonly state: SessionState;
  /** The Turn in flight, whose avatar shimmers; null between Turns. */
  readonly liveTurnId: string | null;
  readonly where: string;
  /** Opens or folds a Turn; it stays so as newer Turns arrive. */
  readonly onSetTurnOpen: (turnId: string, open: boolean) => void;
  readonly onOpenDiff: (turnId: string) => void;
  readonly onRespond: (request: ApprovalRequest, decision: ApprovalDecision) => void;
  readonly onContinue: () => void;
  readonly onRetry: () => void;
  /** "Opus 5 · high", as the Harness names them. */
  readonly modelLabel: (model: string | null, effort: string | null) => string;
  /** A Turn is in flight that takes steers (a failed steer retries as one). */
  readonly canSteer: boolean;
  readonly outbox: Pick<OutboxActions, "retry" | "edit">;
  /** Where a folded Turn's diff comes from, for its +/− counts. */
  readonly diff: { readonly hostKey: string; readonly cwd: string; readonly sessionId: SessionId };
  /** Polaris-authored Turns and the closing row, from the session's chrome (`chrome.ts`). */
  readonly chrome: SessionChrome;
}

const AVATAR = "w-6 shrink-0";

/** A folded Turn's +/− from its diff (cached, so reopening a session paints them at once). */
const SummaryCounts = ({
  row,
  ctx,
}: {
  row: Extract<Row, { kind: "summary" }>;
  ctx: RowContext;
}) => {
  const state = useTurnDiff(
    ctx.diff.hostKey,
    ctx.diff.cwd,
    ctx.diff.sessionId,
    row.turnId,
    row.status
  );

  if (state.kind !== "ready" || state.files.length === 0)
    return row.files === 0 ? null : (
      <span className="text-caption text-text-subtle tabular">{plural(row.files, "file")}</span>
    );
  const sum = totals(state.files);

  return (
    <span
      className="text-code-inline tabular flex shrink-0 gap-1.5 font-mono"
      data-testid="turn-counts"
    >
      <span className="text-diff-added-text">+{sum.added}</span>
      <span className="text-diff-removed-text">−{sum.removed}</span>
    </span>
  );
};

const Summary = ({ row, ctx }: { row: Extract<Row, { kind: "summary" }>; ctx: RowContext }) => (
  <button
    type="button"
    onClick={() => ctx.onSetTurnOpen(row.turnId, true)}
    aria-label={`Turn ${row.number}: ${row.summary}`}
    className="rounded-row border-hairline bg-surface-raised/50 hover:bg-fill-hover gap-row-x flex h-10 w-full cursor-default items-center border px-3 text-left"
    data-testid="turn-summary"
  >
    <span className="text-caption text-text-subtle tabular shrink-0 font-medium">
      Turn {row.number}
    </span>
    <span className="text-body text-text-subtle flex-1 truncate">{row.summary}</span>
    {row.status === "completed" ? null : (
      <span className="text-caption text-text-subtle">{row.status}</span>
    )}
    <SummaryCounts row={row} ctx={ctx} />
    <ChevronRightIcon size={10} className="text-text-faint shrink-0" />
  </button>
);

/** When the Turn started; the full date and time on hover. */
const TurnTime = ({ iso }: { iso: string }) => {
  const text = turnTime(iso, new Date());

  return text === "" ? null : (
    <time
      dateTime={iso}
      title={new Date(iso).toLocaleString()}
      className="tabular shrink-0"
      data-testid="turn-time"
    >
      {text}
    </time>
  );
};

/** Folds an open Turn to its summary; quiet until the row is hovered or focused. */
const FoldButton = ({ row, ctx }: { row: { turnId: string; number: number }; ctx: RowContext }) => (
  <button
    type="button"
    onClick={() => ctx.onSetTurnOpen(row.turnId, false)}
    aria-label={`Fold turn ${row.number}`}
    title="Fold this turn"
    className="rounded-control text-text-faint hover:text-text-subtle hover:bg-fill-hover focus-visible:text-text-subtle grid size-5 shrink-0 cursor-default place-items-center opacity-0 group-focus-within/turn:opacity-100 group-hover/turn:opacity-100 focus-visible:opacity-100"
    data-testid="turn-fold"
  >
    <ChevronDownIcon size={10} />
  </button>
);

const Prompt = ({ row, ctx }: { row: Extract<Row, { kind: "prompt" }>; ctx: RowContext }) => (
  <div className="group/turn flex flex-col items-end gap-1.5" data-testid="prompt">
    <SentAttachments hostKey={ctx.diff.hostKey} attachments={row.attachments} />
    {row.text === "" ? null : (
      <p className="rounded-card bg-fill-selected text-body text-text-strong py-row-x max-w-[340px] px-3.5 break-words whitespace-pre-wrap">
        {softWrap(row.text)}
      </p>
    )}
    <div className="text-caption text-text-subtle flex max-w-[340px] min-w-0 items-center gap-1.5">
      <FoldButton row={row} ctx={ctx} />
      <span className="min-w-0 truncate" data-testid="turn-model">
        {ctx.modelLabel(row.model, row.effort)}
      </span>
      <span aria-hidden="true">·</span>
      <TurnTime iso={row.startedAt} />
    </div>
  </div>
);

/** A Turn the Harness started: what woke it, its Model and time, and the fold control. */
const TriggerRow = ({ row, ctx }: { row: Extract<Row, { kind: "trigger" }>; ctx: RowContext }) => {
  const time = turnTime(row.startedAt, new Date());
  const label = ctx.modelLabel(row.model, row.effort);

  return (
    <div className="group/turn flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <Trigger text={row.text} model={[label, time].filter((p) => p !== "").join(" · ")} />
      </div>
      <FoldButton row={row} ctx={ctx} />
    </div>
  );
};

/** An item's kind, or "run" / "subagent" for those rows (tests and smoke read it). */
const entryKind = (entry: Entry) => (entry.kind === "item" ? entry.item.kind : entry.kind);

const Agent = ({ row, ctx }: { row: Extract<Row, { kind: "item" }>; ctx: RowContext }) => (
  <div className="flex gap-3" data-testid="turn-item" data-kind={entryKind(row.entry)}>
    <div className={AVATAR}>
      {row.lead && ctx.harness !== null ? (
        <HarnessMark
          harness={ctx.harness}
          size={24}
          {...(row.turnId === ctx.liveTurnId ? { state: "working" as const } : {})}
        />
      ) : null}
    </div>
    <div className="flex min-w-0 flex-1 flex-col">
      <EntryView
        entry={row.entry}
        ctx={{ hue: ctx.harness, onOpenDiff: () => ctx.onOpenDiff(row.turnId) }}
      />
    </div>
  </div>
);

const KIND_WANTS: Record<ApprovalRequest["kind"], string> = {
  command: "wants to run a command",
  "file-change": "wants to change files",
  tool: "wants to use a tool",
  question: "has a question",
};

/** DESIGN.md Needs You: the washed header strip and numbered rows; free text goes in the composer. */
const Question = ({ request, ctx }: { request: ApprovalRequest; ctx: RowContext }) => {
  const now = useNow(60_000);
  const answers = questionAnswers(request.options);

  return (
    <QuestionCard
      data-testid="question"
      harness={ctx.harness ?? ""}
      age={age(request.openedAt, now)}
      question={request.title}
      {...(request.detail === null ? {} : { context: request.detail })}
      answers={answers}
      onAnswer={(index) => {
        const chosen = answers[index];

        if (chosen !== undefined) ctx.onRespond(request, Decisions.Answer({ text: chosen.value }));
      }}
    />
  );
};

const Approval = ({ request, ctx }: { request: ApprovalRequest; ctx: RowContext }) => {
  if (request.kind === "question") return <Question request={request} ctx={ctx} />;
  const who = ctx.harness === null ? "The agent" : harnessHue(ctx.harness).name;
  const respond = (decision: ApprovalDecision) => ctx.onRespond(request, decision);

  return (
    <div className="rounded-card border-hairline bg-surface-raised border" data-testid="approval">
      {ctx.harness === null ? (
        <p className="text-caption text-needs-you p-3.5">{request.title}</p>
      ) : (
        <ApprovalCard
          harness={ctx.harness}
          title={request.title}
          summary={`${who} ${KIND_WANTS[request.kind]}`}
          command={request.detail ?? request.title}
          where={ctx.where}
          onApprove={() => respond(Decisions.Allow({ remember: false }))}
          onAlwaysAllow={() => respond(Decisions.Allow({ remember: true }))}
          onDeny={() => respond(Decisions.Deny({ reason: null }))}
        />
      )}
    </div>
  );
};

const Ending = ({ row, ctx }: { row: Extract<Row, { kind: "ending" }>; ctx: RowContext }) => (
  <div className="flex items-center gap-3" data-testid="turn-ending">
    <div className={cn(AVATAR, "flex justify-center")}>
      {row.status === "failed" ? <PixelFailedIcon size={14} className="text-failed" /> : null}
      {row.canContinue ? (
        <Tile hue="needs-you" size={24}>
          <PixelHandIcon size={14} className="text-needs-you" />
        </Tile>
      ) : null}
    </div>
    <p className="text-body text-text-subtle flex-1">
      {row.status === "failed"
        ? `Turn ${row.number} failed`
        : `Turn ${row.number} was interrupted${row.canContinue ? " when the daemon stopped" : ""}`}
    </p>
    {row.canContinue ? (
      <Button variant="secondary" onClick={ctx.onContinue}>
        Continue
      </Button>
    ) : null}
    {row.canRetry ? (
      <Button variant="secondary" onClick={ctx.onRetry}>
        Retry
      </Button>
    ) : null}
  </div>
);

/** A folded Turn: its summary row, or the Polaris card (a digest, a brief) folded. */
const FoldedTurn = ({ row, ctx }: { row: Extract<Row, { kind: "summary" }>; ctx: RowContext }) =>
  ctx.chrome.promptCard?.({
    turnId: row.turnId,
    folded: true,
    canFold: true,
    onToggle: () => ctx.onSetTurnOpen(row.turnId, true),
  }) ?? <Summary row={row} ctx={ctx} />;

/** One row, by kind. */
export const ConversationRow = ({ row, ctx }: { row: Row; ctx: RowContext }) => {
  switch (row.kind) {
    case "setup":
      return <SetupCard setup={row.setup} />;
    case "summary":
      return <FoldedTurn row={row} ctx={ctx} />;
    case "prompt":
      return (
        ctx.chrome.promptCard?.({
          turnId: row.turnId,
          folded: false,
          canFold: true,
          onToggle: () => ctx.onSetTurnOpen(row.turnId, false),
        }) ?? <Prompt row={row} ctx={ctx} />
      );
    case "trigger":
      return <TriggerRow row={row} ctx={ctx} />;
    case "waiting":
      return <Waiting tasks={row.tasks} hue={ctx.harness} />;
    case "trailer":
      return ctx.chrome.trailer ?? null;
    case "item":
      return row.entry.kind === "item" && row.entry.item.kind === "user" ? (
        <Steered text={row.entry.item.text} />
      ) : (
        <Agent row={row} ctx={ctx} />
      );
    case "outgoing":
      return (
        <OutgoingMessage
          entry={row.entry}
          hostKey={ctx.diff.hostKey}
          canSteer={ctx.canSteer}
          onRetry={() => ctx.outbox.retry(row.entry.id)}
          onEdit={() => ctx.outbox.edit(row.entry.id)}
        />
      );
    case "approval":
      return <Approval request={row.request} ctx={ctx} />;
    case "ending":
      return <Ending row={row} ctx={ctx} />;
  }
};
