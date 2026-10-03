/**
 * The Claim card (DESIGN.md, The Claim card) at the end of a worker's transcript, and its
 * review form when the Constellation is paused or the Lead handed the Claim up (C3):
 * Approve (the Lead merges and accepts), Accept (already merged) or Send back.
 */
import { type AttemptState, ReviewAction, WorkerPlacement } from "@polaris/protocol";
import { Button, cn, Input, PixelHandIcon, SegmentedControl, Textarea } from "@polaris/ui";
import { type ReactNode, useState } from "react";
import { useLeadBranch } from "../hooks.ts";
import {
  type AttemptData,
  type ClaimData,
  type ClaimPlace,
  type ConstellationRecord,
  type Facts,
  headMatches,
  type ReceiptView,
  receiptView,
  type RefusalCopy,
  shortSha,
  type TaskData,
} from "../model/index.ts";
import type { ReviewMode } from "../state.ts";
import { approveClaim, placeOf, reviewClaim, toastRefusal } from "./claimActions.ts";
import { TaskGlyph } from "./glyphs.tsx";
import { CheckMark } from "./strip.tsx";
import { EditorPlaceProvider, FileLink } from "../../editor-links/index.ts";

const Receipt = ({ r }: { readonly r: ReceiptView }) => (
  <li className="flex h-7 items-center gap-2.5 px-3.5">
    <CheckMark check={r} />
    <span className="text-code-inline text-text-default min-w-0 flex-1 truncate font-mono">
      {r.command ?? r.label}
    </span>
    <span className="text-caption text-text-subtle shrink-0">
      {r.tier}
      {r.exitCode === null ? "" : ` · exit ${r.exitCode}`}
    </span>
  </li>
);

const Row = ({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) => (
  <div className="flex gap-3">
    <dt className="text-body text-text-subtle w-20 shrink-0">{label}</dt>
    <dd className={cn("text-body text-text-default min-w-0", tone)}>{children}</dd>
  </div>
);

const Facts_ = ({ claim, task }: { readonly claim: ClaimData; readonly task: TaskData }) => (
  <dl className="border-hairline flex flex-col gap-1 border-t px-3.5 py-2.5">
    {claim.notDone.map((text, n) => (
      <Row key={`nd${n}`} label={n === 0 ? "Not done" : ""}>
        {text}
      </Row>
    ))}
    {claim.questions.map((q) => (
      <Row key={q.id} label="Question" tone="text-needs-you-text">
        {q.text}
      </Row>
    ))}
    {claim.decisions.map((text, n) => (
      <Row key={`d${n}`} label={n === 0 ? "Decided" : ""}>
        {text}
      </Row>
    ))}
    <Row label="Area">
      {claim.outsideArea.length === 0
        ? task.area.length === 0
          ? "No area declared"
          : `Stayed inside ${task.area.join(", ")}`
        : claim.outsideArea.map((o) => (
            <span key={o.path} className="block">
              <FileLink path={o.path} className="text-code-inline font-mono" /> · {o.reason}
            </span>
          ))}
    </Row>
  </dl>
);

const Choice = ({
  checked,
  onSelect,
  label,
  hint,
  square = false,
}: {
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly label: string;
  readonly hint: ReactNode;
  readonly square?: boolean;
}) => (
  <button
    type="button"
    role={square ? "checkbox" : "radio"}
    aria-checked={checked}
    onClick={onSelect}
    className="flex h-7 cursor-default items-center gap-2.5 text-left"
  >
    <span
      className={cn(
        "border-text-subtle grid size-3.5 shrink-0 place-items-center border",
        square ? "rounded-[3px]" : "rounded-full"
      )}
    >
      {checked ? (
        <span
          className={cn("bg-text-strong size-1.5", square ? "rounded-[1px]" : "rounded-full")}
        />
      ) : null}
    </span>
    <span className="text-body text-text-default">{label}</span>
    <span className="text-body text-text-subtle">{hint}</span>
  </button>
);

interface FormProps {
  readonly hostKey: string;
  readonly record: ConstellationRecord;
  readonly task: TaskData;
  readonly attempt: AttemptData;
  readonly claim: ClaimData;
  readonly mode: ReviewMode;
  readonly onMode: (mode: ReviewMode) => void;
  readonly onClose: () => void;
  readonly onOpenInReview: () => void;
  readonly place: ClaimPlace;
}

const Mono = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-code-inline text-text-strong font-mono">{children}</span>
);

const Approve = ({ hostKey, record, task, attempt, place, onClose }: FormProps) => {
  const approved = attempt.approvedByUserAt != null;

  return (
    <div className="flex flex-col gap-2 px-3.5 pb-3.5" data-testid="claim-approve">
      <p className="text-body text-text-default">
        {approved ? "You approved it. " : "Records your verdict. "}The lead merges{" "}
        <Mono>{place.branch}</Mono> at <Mono>{shortSha(place.head)}</Mono> into{" "}
        {place.leadBranch === null ? "its branch" : <Mono>{place.leadBranch}</Mono>} and accepts it.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="primary"
          disabled={approved}
          onClick={() =>
            void approveClaim(hostKey, record, attempt, place).then((ok) =>
              ok ? onClose() : undefined
            )
          }
        >
          {approved ? "Approved" : `Approve ${task.id}`}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <span className="flex-1" />
        <span className="text-caption text-text-subtle">the lead is told</span>
      </div>
    </div>
  );
};

const SendBack = ({ hostKey, record, task, attempt, place, onClose }: FormProps) => {
  const [reason, setReason] = useState("");
  const [fresh, setFresh] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [base, setBase] = useState(attempt.base);

  const send = () =>
    void reviewClaim(
      hostKey,
      {
        constellationId: record.constellation.id,
        attemptId: attempt.id,
        revision: attempt.revision,
        action: ReviewAction.cases.SendBack.make({
          reason: reason.trim(),
          worker: fresh
            ? WorkerPlacement.cases.New.make({
                hostId: attempt.hostId,
                worktree: attempt.worktree,
                branch: attempt.branch,
                base: attempt.base,
              })
            : WorkerPlacement.cases.Existing.make({ sessionId: attempt.sessionId }),
          mergeConflictBase: conflict ? base : null,
        }),
      },
      place
    ).then((refused) =>
      refused === null ? onClose() : toastRefusal(`Couldn't send ${task.id} back`, refused)
    );

  return (
    <div className="flex flex-col gap-2 px-3.5 pb-3.5">
      <label className="text-caption text-text-subtle" htmlFor="send-back-reason">
        Reason
      </label>
      <Textarea
        id="send-back-reason"
        autoFocus
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div role="radiogroup" aria-label="Where the next attempt runs" className="flex flex-col">
        <Choice
          checked={!fresh}
          onSelect={() => setFresh(false)}
          label="Same session"
          hint="a new Turn with the reason"
        />
        <Choice
          checked={fresh}
          onSelect={() => setFresh(true)}
          label="Fresh session"
          hint="same worktree, brief + this claim"
        />
      </div>
      <div className="flex items-center gap-2">
        <Choice
          square
          checked={conflict}
          onSelect={() => setConflict(!conflict)}
          label="Merge conflict"
          hint={
            conflict ? (
              "merge first:"
            ) : (
              <>
                merge <span className="text-code-inline font-mono">{base}</span> first
              </>
            )
          }
        />
        {conflict ? (
          <Input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="h-7 w-40 font-mono"
            aria-label="Base to merge first"
          />
        ) : null}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="primary"
          disabled={reason.trim() === "" || (conflict && base.trim() === "")}
          onClick={send}
        >
          Send back to {task.id}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <span className="flex-1" />
        <span className="text-caption text-text-subtle">the lead is told</span>
      </div>
    </div>
  );
};

const tierOf = (receipts: ReadonlyArray<ReceiptView>) => {
  if (receipts.length === 0) return "asserted";

  return receipts.some((r) => r.tier === "verified") ? "verified" : "reported";
};

/** Why Accept was refused, in the user's words, with Approve beside it when that would work. */
const Refused = ({
  copy,
  onApprove,
}: {
  readonly copy: RefusalCopy;
  readonly onApprove: () => void;
}) => (
  <div
    role="alert"
    data-testid="claim-refused"
    className="rounded-control bg-fill-selected flex items-center gap-3 px-3 py-2"
  >
    <span className="text-body text-text-default min-w-0 flex-1">{copy.message}</span>
    {copy.offerApprove ? (
      <Button size="xs" variant="secondary" onClick={onApprove}>
        Approve instead
      </Button>
    ) : null}
  </div>
);

const Accept = ({
  hostKey,
  record,
  task,
  attempt,
  claim,
  place,
  onClose,
  onMode,
  facts,
}: FormProps & { readonly facts: Facts }) => {
  const [head, setHead] = useState(claim.head);
  const [refused, setRefused] = useState<RefusalCopy | null>(null);
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set(claim.receipts.map((_, n) => n)));
  const views = claim.receipts.map((r) => receiptView(r, facts));
  const matches = headMatches(claim.head, head);

  const accept = () =>
    void reviewClaim(
      hostKey,
      {
        constellationId: record.constellation.id,
        attemptId: attempt.id,
        revision: attempt.revision,
        action: ReviewAction.cases.Accept.make({
          mergedHead: head.trim(),
          receipts: claim.receipts.filter((_, n) => kept.has(n)),
        }),
      },
      place
    ).then((copy) => (copy === null ? onClose() : setRefused(copy)));

  return (
    <div className="flex flex-col gap-2 px-3.5 pb-3.5">
      <label className="text-caption text-text-subtle" htmlFor="merged-head">
        Merged head
      </label>
      <Input
        id="merged-head"
        autoFocus
        value={head}
        onChange={(e) => setHead(e.target.value)}
        className="font-mono"
      />
      {matches ? null : (
        <p className="text-caption text-failed-text">
          It must match the claimed head, {shortSha(claim.head)}.
        </p>
      )}
      {matches && refused === null ? (
        <p className="text-caption text-text-subtle">
          Merge {place.branch} into {place.leadBranch ?? "the lead's branch"} first.
        </p>
      ) : null}
      <p className="text-caption text-text-subtle pt-1">Receipts</p>
      {views.map((r, n) => (
        <Choice
          key={`${r.label}${n}`}
          square
          checked={kept.has(n)}
          onSelect={() => {
            const next = new Set(kept);

            if (!next.delete(n)) next.add(n);
            setKept(next);
          }}
          label={r.label}
          hint={r.tier}
        />
      ))}
      {refused === null ? null : <Refused copy={refused} onApprove={() => onMode("approve")} />}
      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" disabled={!matches} onClick={accept}>
          Accept {task.id}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <span className="flex-1" />
        <span className="text-caption text-text-subtle">
          {tierOf(views.filter((_, n) => kept.has(n)))} · the lead is told
        </span>
      </div>
    </div>
  );
};

export interface ClaimCardProps {
  readonly hostKey: string;
  readonly record: ConstellationRecord;
  readonly task: TaskData;
  readonly attempt: AttemptData;
  readonly facts: Facts;
  /** The Lead handed the Claim up: review here, Approve first. */
  readonly handed: boolean;
  /** The Constellation is paused: review here. */
  readonly paused: boolean;
  readonly review: ReviewMode | null;
  readonly onReview: (mode: ReviewMode | null) => void;
  readonly onOpenInReview: () => void;
  readonly menu: ReactNode;
  readonly leadMark: ReactNode;
}

const STATE_WORD: Readonly<Record<AttemptState, string>> = {
  working: "working",
  blocked: "blocked",
  review: "in review",
  accepted: "accepted",
  rejected: "sent back",
  lost: "lost",
  failed: "failed",
};

const ClaimHead = ({
  attempt,
  claim,
}: {
  readonly attempt: AttemptData;
  readonly claim: ClaimData;
}) => {
  const accepted = attempt.state === "accepted";

  return (
    <div className="border-hairline flex h-10 items-center gap-2 border-b px-3.5">
      <TaskGlyph glyph={accepted ? "accepted" : "review"} harness={null} size={14} />
      <span className="text-label text-text-strong">Claim</span>
      <span className={cn("text-body", accepted ? "text-accepted-text" : "text-text-subtle")}>
        {STATE_WORD[attempt.state]}
      </span>
      <span className="flex-1" />
      <span className="text-code-inline text-text-subtle font-mono">
        {shortSha(claim.head)} ·{" "}
        {claim.commits.length === 1 ? "1 commit" : `${claim.commits.length} commits`}
      </span>
    </div>
  );
};

const footWord = (attempt: AttemptData, claim: ClaimData) => {
  if (attempt.state === "review")
    return attempt.approvedByUserAt == null
      ? "The lead is reviewing"
      : "You approved · the lead merges and accepts";

  return attempt.state === "accepted"
    ? `Accepted at ${shortSha(attempt.mergedHead ?? claim.head)}`
    : STATE_WORD[attempt.state];
};

const ClaimFoot = ({
  props,
  claim,
}: {
  readonly props: ClaimCardProps;
  readonly claim: ClaimData;
}) => (
  <div className="border-hairline flex h-10 items-center gap-2 border-t px-3.5">
    {props.leadMark}
    <span className="text-body text-text-subtle">{footWord(props.attempt, claim)}</span>
    <span className="flex-1" />
    <Button size="xs" variant="ghost" onClick={props.onOpenInReview}>
      Open in Review ↗
    </Button>
    {props.menu}
  </div>
);

export const ReviewArea = ({
  form,
  mode,
  facts,
}: {
  readonly form: FormProps;
  readonly mode: ReviewMode;
  readonly facts: Facts;
}) => (
  <>
    <div className="px-3.5 pb-2.5">
      <SegmentedControl
        variant="fill"
        aria-label="Review"
        value={mode}
        onValueChange={form.onMode}
        options={[
          { value: "approve", label: "Approve" },
          { value: "accept", label: "Accept" },
          { value: "send-back", label: "Send back" },
        ]}
      />
    </div>
    {mode === "approve" ? <Approve {...form} /> : null}
    {mode === "accept" ? (
      <Accept
        key={`${form.attempt.id}:${form.attempt.revision}:${form.claim.head}`}
        {...form}
        facts={facts}
      />
    ) : null}
    {mode === "send-back" ? <SendBack {...form} /> : null}
  </>
);

/**
 * Review here when the Lead handed the Claim up (Approve first, until approved) or the
 * Constellation is paused; else read it.
 */
export const reviewMode = (
  props: Pick<ClaimCardProps, "attempt" | "review" | "handed" | "paused">
): ReviewMode | null => {
  const { attempt } = props;

  if (attempt.state !== "review") return null;

  if (props.review !== null) return props.review;

  if (props.handed && attempt.approvedByUserAt == null) return "approve";

  return props.paused ? "send-back" : null;
};

export const ClaimCard = (props: ClaimCardProps) => {
  const { attempt, task, facts } = props;
  const claim = attempt.claim;
  const leadBranch = useLeadBranch(props.hostKey, props.record.constellation.leadSessionId);

  if (claim == null) return null;
  const receipts = claim.receipts.map((r) => receiptView(r, facts));
  const mode = reviewMode(props);
  const place = placeOf(attempt, leadBranch);

  const form: FormProps = {
    hostKey: props.hostKey,
    record: props.record,
    task,
    attempt,
    claim,
    mode: mode ?? "accept",
    onMode: (m) => props.onReview(m),
    onClose: () => props.onReview(null),
    onOpenInReview: props.onOpenInReview,
    place,
  };

  return (
    <div className="flex flex-col gap-3 pl-9">
      <div
        className="rounded-row border-hairline bg-surface-sunken border"
        data-testid="claim-card"
      >
        <ClaimHead attempt={attempt} claim={claim} />
        {receipts.length === 0 ? (
          <p className="text-body text-text-subtle px-3.5 py-2.5">No receipts: asserted</p>
        ) : (
          <ul className="py-1">
            {receipts.map((r, n) => (
              <Receipt key={`${r.label}${n}`} r={r} />
            ))}
          </ul>
        )}
        <EditorPlaceProvider value={{ hostKey: props.hostKey, root: attempt.worktree }}>
          <Facts_ claim={claim} task={task} />
        </EditorPlaceProvider>
        {props.handed && attempt.state === "review" && attempt.approvedByUserAt == null ? (
          <div className="bg-needs-you-fill text-needs-you-text text-body rounded-control mx-3.5 mb-2.5 flex items-center gap-2 px-3 py-2">
            <PixelHandIcon size={12} className="text-needs-you shrink-0" />
            <span className="shrink-0">The lead handed this claim to you</span>
            {attempt.handedUpReason == null ? null : (
              <span className="text-needs-you-text/75 min-w-0 truncate">
                {attempt.handedUpReason}
              </span>
            )}
          </div>
        ) : null}
        {mode === null ? (
          <ClaimFoot props={props} claim={claim} />
        ) : (
          <ReviewArea form={form} mode={mode} facts={facts} />
        )}
      </div>
      {mode === null ? null : (
        <p className="text-body text-text-subtle pl-1">
          Read the diff first?{" "}
          <button
            type="button"
            className="text-text-strong cursor-default"
            onClick={props.onOpenInReview}
          >
            Open {task.id} in Review ↗
          </button>
        </p>
      )}
    </div>
  );
};
