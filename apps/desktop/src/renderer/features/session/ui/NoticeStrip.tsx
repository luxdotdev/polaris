/**
 * The composer's notice strip (Paper X-E): one notice at a time by priority, the rest behind
 * "+n"; the chevron expands every notice and the queued follow-ups. Nothing to know, no strip.
 */
import type { ApprovalDecision, ApprovalRequest } from "@polaris/protocol";
import {
  Button,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  cn,
  ContextRing,
  type Harness,
  harnessHue,
  PixelHandIcon,
  WorkingStrip,
} from "@polaris/ui";
import { type ReactNode, useState } from "react";
import { Decisions } from "../../../commands.ts";
import { capacityReset } from "../../constellation/model/failure.ts";
import type { Notice } from "../model/notices.ts";

export interface NoticeStripProps {
  readonly harness: Harness;
  readonly notices: ReadonlyArray<Notice>;
  readonly working:
    | {
        readonly elapsed: ReactNode;
        readonly onStop: () => void;
        readonly label?: ReactNode;
        readonly detail?: ReactNode;
      }
    | undefined;
  readonly onRespond: (request: ApprovalRequest, decision: ApprovalDecision) => void;
  /** A queued follow-up back into the draft. */
  readonly onUnqueue: (id: string) => void;
  /** The Harness's `/compact`, when it lists one. */
  readonly onCompact: (() => void) | null;
  readonly onDismissContext: (share: number) => void;
  readonly onSwitchModel: () => void;
}

const ROW = "gap-row-x pr-gap relative flex h-[42px] shrink-0 items-center pl-[18px]";

const QueueGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
    <path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const ClockGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
    <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <path d="M6 3.5V6l1.75 1.25" fill="none" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

/** "+1 ⌃": the notices behind this one; the chevron alone when only detail is folded. */
const More = ({
  count,
  open,
  onToggle,
}: {
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    aria-label={open ? "Show less" : count > 0 ? `${count} more` : "Show all"}
    data-testid="notice-more"
    className="text-caption text-text-subtle hover:text-text-default hover:bg-fill-hover tabular relative flex h-6 shrink-0 cursor-default items-center gap-1 rounded-full bg-[light-dark(#0000000a,#ffffff0d)] px-2"
  >
    {count > 0 ? `+${count}` : null}
    {open ? <ChevronUpIcon size={10} /> : <ChevronDownIcon size={10} />}
  </button>
);

interface RowProps {
  readonly notice: Notice;
  readonly props: NoticeStripProps;
  readonly more: ReactNode;
}

const Approval = ({
  request,
  props,
  more,
}: {
  readonly request: ApprovalRequest;
  readonly props: NoticeStripProps;
  readonly more: ReactNode;
}) => {
  const who = harnessHue(props.harness).name;
  const question = request.kind === "question";

  return (
    <div
      className={cn(ROW, "bg-[color-mix(in_oklab,var(--color-needs-you)_7%,transparent)]")}
      data-testid="notice-approval"
    >
      <PixelHandIcon size={14} className="text-needs-you shrink-0" />
      <span className="text-body text-needs-you-text shrink-0 font-medium">
        {question ? `${who} has a question` : `${who} wants to run`}
      </span>
      {question ? null : (
        <code className="text-code-inline bg-well text-text-default min-w-0 truncate rounded-[5px] px-1.5 py-0.5 font-mono">
          {request.detail ?? request.title}
        </code>
      )}
      <span className="flex-1" />
      {more}
      {question ? null : (
        <>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => props.onRespond(request, Decisions.Deny({ reason: null }))}
          >
            Deny
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="rounded-full"
            onClick={() => props.onRespond(request, Decisions.Allow({ remember: false }))}
          >
            Approve
          </Button>
        </>
      )}
    </div>
  );
};

const Working = ({ props, more }: { props: NoticeStripProps; more: ReactNode }) =>
  props.working === undefined ? null : (
    <WorkingStrip
      harness={props.harness}
      elapsed={props.working.elapsed}
      onStop={props.working.onStop}
      detail={props.working.detail}
      trailing={more}
    >
      {props.working.label}
    </WorkingStrip>
  );

const Queued = ({ count, more }: { readonly count: number; readonly more: ReactNode }) => (
  <div className={ROW} data-testid="notice-queued">
    <span className="text-text-subtle">
      <QueueGlyph />
    </span>
    <span className="text-body text-text-strong tabular shrink-0 font-medium">{count} queued</span>
    <span className="text-caption text-text-subtle min-w-0 truncate">
      · sent when this turn ends
    </span>
    <span className="flex-1" />
    {more}
  </div>
);

const QueuedList = ({
  entries,
  onUnqueue,
}: {
  readonly entries: Extract<Notice, { kind: "queued" }>["entries"];
  readonly onUnqueue: (id: string) => void;
}) => (
  <ol className="flex flex-col gap-1.5 px-2.5 pb-2.5" data-testid="queued-list">
    {entries.map((entry, i) => (
      <li
        key={entry.id}
        className="bg-well gap-row-x flex h-[30px] items-center rounded-[10px] pr-1 pl-3"
      >
        <span className="text-caption text-text-subtle tabular w-3 shrink-0 font-mono">
          {i + 1}
        </span>
        <span className="text-body text-text-default min-w-0 flex-1 truncate">{entry.text}</span>
        <button
          type="button"
          aria-label="Back to the draft"
          title="Back to the draft"
          onClick={() => onUnqueue(entry.id)}
          className="text-text-subtle hover:text-text-default hover:bg-fill-hover grid size-6 shrink-0 cursor-default place-items-center rounded-full"
        >
          <CloseIcon size={10} />
        </button>
      </li>
    ))}
  </ol>
);

const Context = ({
  share,
  props,
  more,
}: {
  share: number;
  props: NoticeStripProps;
  more: ReactNode;
}) => (
  <div className={ROW} data-testid="notice-context">
    <ContextRing share={share} className="size-3" />
    <span className="text-body text-text-strong tabular shrink-0 font-medium">
      Context {Math.round(share * 100)}%
    </span>
    <span className="text-caption text-text-subtle min-w-0 truncate">· nearly full</span>
    <span className="flex-1" />
    {more}
    {props.onCompact === null ? null : (
      <Button variant="secondary" size="sm" className="rounded-full" onClick={props.onCompact}>
        Compact
      </Button>
    )}
    <button
      type="button"
      aria-label="Close"
      onClick={() => props.onDismissContext(share)}
      className="text-text-subtle hover:text-text-default hover:bg-fill-hover grid size-6 shrink-0 cursor-default place-items-center rounded-full"
    >
      <CloseIcon size={10} />
    </button>
  </div>
);

const Limited = ({
  resetsAt,
  props,
  more,
}: {
  readonly resetsAt: string | null;
  readonly props: NoticeStripProps;
  readonly more: ReactNode;
}) => (
  <div className={ROW} data-testid="notice-limited">
    <span className="text-text-subtle">
      <ClockGlyph />
    </span>
    <span className="text-body text-text-strong shrink-0 font-medium">
      {harnessHue(props.harness).name}'s usage limit reached
    </span>
    <span className="text-caption text-text-subtle min-w-0 truncate">
      · {capacityReset(resetsAt)}
    </span>
    <span className="flex-1" />
    {more}
    <Button variant="secondary" size="sm" className="rounded-full" onClick={props.onSwitchModel}>
      Switch model
    </Button>
  </div>
);

const NoticeRow = ({ notice, props, more }: RowProps) => {
  switch (notice.kind) {
    case "approval":
      return <Approval request={notice.request} props={props} more={more} />;
    case "working":
      return <Working props={props} more={more} />;
    case "queued":
      return <Queued count={notice.entries.length} more={more} />;
    case "context":
      return <Context share={notice.share} props={props} more={more} />;
    case "limited":
      return <Limited resetsAt={notice.resetsAt} props={props} more={more} />;
  }
};

/** A notice and, when expanded, the queued follow-ups under it. */
const Expanded = ({ notice, props }: { notice: Notice; props: NoticeStripProps }) => (
  <div className="border-hairline border-t">
    <NoticeRow notice={notice} props={props} more={null} />
    {notice.kind === "queued" ? (
      <QueuedList entries={notice.entries} onUnqueue={props.onUnqueue} />
    ) : null}
  </div>
);

export const NoticeStrip = (props: NoticeStripProps) => {
  const [open, setOpen] = useState(false);
  const [top, ...rest] = props.notices;

  if (top === undefined) return null;

  const folds = rest.length > 0 || top.kind === "queued";

  const more = folds ? (
    <More count={rest.length} open={open} onToggle={() => setOpen(!open)} />
  ) : null;

  return (
    <div
      className={cn(
        "border-hairline flex shrink-0 flex-col",
        (top.kind !== "working" || open) && "border-b"
      )}
      data-testid="notice-strip"
    >
      <NoticeRow notice={top} props={props} more={more} />
      {open && top.kind === "queued" ? (
        <QueuedList entries={top.entries} onUnqueue={props.onUnqueue} />
      ) : null}
      {open ? rest.map((n) => <Expanded key={n.kind} notice={n} props={props} />) : null}
    </div>
  );
};
