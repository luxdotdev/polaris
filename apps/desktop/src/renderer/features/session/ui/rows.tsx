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
  Input,
  PixelFailedIcon,
  PixelHandIcon,
  Tile,
} from "@polaris/ui";
import { useState } from "react";
import { Decisions } from "../../../commands.ts";
import type { Row } from "../model/conversation.ts";
import { plural } from "../model/format.ts";
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

const Prompt = ({ row }: { readonly row: Extract<Row, { kind: "prompt" }> }) => (
  <div className="flex flex-col items-end gap-1.5" data-testid="prompt">
    {row.text === "" ? null : (
      <p className="rounded-card bg-fill-selected text-body text-text-strong py-row-x max-w-[340px] px-3.5 break-words whitespace-pre-wrap">
        {row.text}
      </p>
    )}
    {row.attachments.length === 0 ? null : (
      <p className="text-caption text-text-faint truncate">{row.attachments.join(" · ")}</p>
    )}
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

const Question = ({ request, ctx }: { request: ApprovalRequest; ctx: RowContext }) => {
  const [answer, setAnswer] = useState("");

  const submit = (text: string) => {
    if (text.trim() !== "") ctx.onRespond(request, Decisions.Answer({ text: text.trim() }));
  };

  return (
    <div className="rounded-card border-hairline bg-surface-raised flex flex-col overflow-clip border">
      <div aria-hidden="true" className="pixelated h-1.5 bg-(image:--wash-needs-you) bg-cover" />
      <div className="flex items-center gap-2.5 px-3.5 pt-3">
        <PixelHandIcon size={16} className="text-needs-you shrink-0" />
        <p className="text-label text-text-strong flex-1">{request.title}</p>
      </div>
      {request.detail === null ? null : (
        <p className="text-body text-text-default px-3.5 pt-3">{request.detail}</p>
      )}
      <ol className="flex flex-col px-2 py-2">
        {request.options.map((option, n) => (
          <li key={option}>
            <button
              type="button"
              onClick={() => submit(option)}
              className="rounded-row hover:bg-fill-hover h-row flex w-full cursor-default items-center gap-2.5 px-2 text-left"
            >
              <span className="text-caption text-text-subtle tabular w-4">{n + 1}</span>
              <span className="text-body text-text-default">{option}</span>
            </button>
          </li>
        ))}
      </ol>
      <form
        className="border-hairline flex gap-1.5 border-t px-3.5 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit(answer);
        }}
      >
        <Input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={request.options.length === 0 ? "Your answer" : "Another answer"}
          aria-label="Answer"
        />
        <Button type="submit" disabled={answer.trim() === ""}>
          Answer
        </Button>
      </form>
    </div>
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
      return <Prompt row={row} />;
    case "item":
      return <Agent row={row} ctx={ctx} />;
    case "approval":
      return <Approval request={row.request} ctx={ctx} />;
    case "ending":
      return <Ending row={row} ctx={ctx} />;
  }
};
