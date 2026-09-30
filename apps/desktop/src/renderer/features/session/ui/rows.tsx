/**
 * The conversation's row kinds: a folded Turn, the user's prompt, an agent
 * item (the first one carries the Harness avatar), an inline approval or
 * question, and how an interrupted or failed Turn ended.
 */
import type { ApprovalDecision, ApprovalRequest, SessionState } from "@polaris/protocol";
import {
  ApprovalCard,
  Button,
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
import { useNow } from "../../../shell/useNow.ts";
import { Decisions } from "../../../commands.ts";
import type { Row } from "../model/conversation.ts";
import { plural } from "../model/format.ts";
import { questionAnswers } from "../model/question.ts";
import { Item } from "./items.tsx";

export interface RowContext {
  readonly harness: Harness | null;
  readonly state: SessionState;
  /** The Turn in flight, whose avatar shimmers; null between Turns. */
  readonly liveTurnId: string | null;
  readonly where: string;
  readonly onToggleTurn: (turnId: string) => void;
  readonly onOpenDiff: (turnId: string) => void;
  readonly onRespond: (request: ApprovalRequest, decision: ApprovalDecision) => void;
  readonly onContinue: () => void;
  /** "Opus 5 · high", as the Harness names them. */
  readonly modelLabel: (model: string | null, effort: string | null) => string;
}

const AVATAR = "w-6 shrink-0";

const Summary = ({ row, ctx }: { row: Extract<Row, { kind: "summary" }>; ctx: RowContext }) => (
  <button
    type="button"
    onClick={() => ctx.onToggleTurn(row.turnId)}
    aria-label={`Turn ${row.number}: ${row.summary}`}
    className="rounded-row border-hairline bg-surface-raised/50 hover:bg-fill-hover gap-row-x flex h-10 w-full cursor-default items-center border px-3 text-left"
    data-testid="turn-summary"
  >
    <span className="text-caption text-text-subtle tabular shrink-0 font-medium">
      Turn {row.number}
    </span>
    <span className="text-body text-text-subtle flex-1 truncate">{row.summary}</span>
    {row.status === "completed" ? null : (
      <span className="text-caption text-text-faint">{row.status}</span>
    )}
    {row.files === 0 ? null : (
      <span className="text-caption text-text-faint tabular">{plural(row.files, "file")}</span>
    )}
    <ChevronRightIcon size={10} className="text-text-faint shrink-0" />
  </button>
);

const Prompt = ({ row, ctx }: { row: Extract<Row, { kind: "prompt" }>; ctx: RowContext }) => (
  <div className="flex flex-col items-end gap-1.5" data-testid="prompt">
    {row.text === "" ? null : (
      <p className="rounded-card bg-fill-selected text-body text-text-strong py-row-x max-w-[340px] px-3.5 break-words whitespace-pre-wrap">
        {row.text}
      </p>
    )}
    <p className="text-caption text-text-faint max-w-[340px] truncate" data-testid="turn-model">
      {[...row.attachments, ctx.modelLabel(row.model, row.effort)].join(" · ")}
    </p>
  </div>
);

const Agent = ({ row, ctx }: { row: Extract<Row, { kind: "item" }>; ctx: RowContext }) => (
  <div className="flex gap-3" data-testid="turn-item" data-kind={row.item.kind}>
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
      <Item item={row.item} hue={ctx.harness} onOpenDiff={() => ctx.onOpenDiff(row.turnId)} />
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
  </div>
);

/** One row, by kind. */
export const ConversationRow = ({ row, ctx }: { row: Row; ctx: RowContext }) => {
  switch (row.kind) {
    case "summary":
      return <Summary row={row} ctx={ctx} />;
    case "prompt":
      return <Prompt row={row} ctx={ctx} />;
    case "item":
      return <Agent row={row} ctx={ctx} />;
    case "approval":
      return <Approval request={row.request} ctx={ctx} />;
    case "ending":
      return <Ending row={row} ctx={ctx} />;
  }
};
