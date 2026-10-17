/**
 * The Review header's primary action for a worker session (Paper C4), instead of the normal
 * session Accept: "Attempt N", then Approve with a menu adding Send to @B1 and Accept and
 * merge myself. Any other session keeps M2-A's AcceptAction.
 */
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PixelCheckIcon,
  showToast,
} from "@polaris/ui";
import { type ReactNode, useState } from "react";
import type { SessionSubject } from "../../../routes/review.ts";
import { useApp } from "../../../shell/hooks.ts";
import { AcceptAction } from "../../accept/ui/AcceptAction.tsx";
import { useWorkerAttempt, type WorkerAttempt } from "../../sessions/source.ts";
import { type ReviewSlotProps, subjectKey } from "../surface.ts";
import { useLeadBranch } from "../../constellation/hooks.ts";
import {
  acceptClaim,
  approveClaim,
  type SeenClaim,
  sendToWorker,
  type WorkerTarget,
} from "./actions.ts";
import { workerActionKind } from "./model.ts";

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" />
  </svg>
);

const Item = ({
  title,
  detail,
  onSelect,
  testId,
  disabled = false,
}: {
  readonly title: string;
  readonly detail: ReactNode;
  readonly onSelect: () => void;
  readonly testId: string;
  readonly disabled?: boolean;
}) => (
  <DropdownMenuItem
    data-testid={testId}
    disabled={disabled}
    onSelect={onSelect}
    className="h-auto flex-col items-start gap-0.5 py-2"
  >
    <span className="text-label text-text-strong">{title}</span>
    <span className="text-caption text-text-subtle max-w-[300px] whitespace-normal">{detail}</span>
  </DropdownMenuItem>
);

/** The Lead's Host key and branch, from the Constellation's `hostId`. */
const useLeadPlace = (worker: WorkerAttempt) => {
  const { constellation } = worker.view;

  const hostKey = useApp(
    (s) => s.hosts.find((h) => h.status.host?.hostId === constellation.hostId)?.key ?? null
  );

  return { hostKey, leadBranch: useLeadBranch(hostKey, constellation.leadSessionId) };
};

const attemptNumber = (worker: WorkerAttempt) =>
  worker.view.constellation.attempts
    .filter((a) => a.taskId === worker.task.id)
    .indexOf(worker.attempt) + 1;

const toast = (title: string, message: string) =>
  showToast({ source: "starlight", icon: <PixelCheckIcon size={16} />, title, message });

const ClaimActions = ({
  subject,
  worker,
}: {
  readonly subject: SessionSubject;
  readonly worker: WorkerAttempt;
}) => {
  const { hostKey, leadBranch } = useLeadPlace(worker);
  const [busy, setBusy] = useState(false);
  const { attempt } = worker;
  const id = attempt.taskId;
  const live: SeenClaim = { head: attempt.claim?.head ?? "", revision: attempt.revision };
  // The Claim as the user read it here; an amendment waits until they review it.
  const [seen, setSeen] = useState(live);
  const amended = live.head !== seen.head;
  const head = seen.head.slice(0, 7) || "the claimed head";

  if (hostKey === null) return null;

  const target: WorkerTarget = {
    leadHostKey: hostKey,
    constellationId: worker.view.constellation.id,
    attempt,
  };

  const run = async (work: () => Promise<boolean>, done: () => void) => {
    setBusy(true);

    if (await work()) done();
    setBusy(false);
  };

  const approved = attempt.approvedByUserAt != null;

  const approve = () =>
    void run(
      () => approveClaim(target),
      () => toast(`Approved ${id}`, "The lead merges and accepts it")
    );

  const send = () =>
    void run(
      () => sendToWorker(target, subjectKey(subject)),
      () => toast(`Sent back to ${id}`, "Your feedback goes as its next turn; the lead is told")
    );

  const merge = () =>
    void run(
      () => acceptClaim(target, seen, { leadBranch, onApprove: approve }),
      () => toast(`Merged and accepted ${id}`, "The lead is told")
    );

  return (
    <>
      {amended ? (
        <button
          type="button"
          data-testid="worker-claim-amended"
          onClick={() => setSeen(live)}
          className="rounded-control text-label text-needs-you-text border-hairline flex h-[30px] cursor-default items-center border px-3"
        >
          Claim amended · review {live.head.slice(0, 7)}
        </button>
      ) : null}
      <div
        data-testid="worker-review-action"
        className={cn(
          "rounded-control text-label bg-text-strong text-bg flex h-[30px] items-center overflow-clip",
          busy && "opacity-60"
        )}
      >
        <button
          type="button"
          data-testid="worker-approve-primary"
          disabled={busy || approved || amended}
          title={approved ? "You approved it; the lead merges and accepts it" : undefined}
          onClick={approve}
          className="flex h-[30px] cursor-default items-center px-3 font-medium"
        >
          {approved ? "Approved" : "Approve"}
        </button>
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-current opacity-20" />
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={busy}
            aria-label="More review options"
            className="w-tree-row flex h-[30px] shrink-0 items-center justify-center"
          >
            <Chevron />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[320px]">
            <Item
              testId="worker-approve"
              title={approved ? "Approved" : "Approve"}
              disabled={approved || amended}
              detail="Records your verdict; the lead merges and accepts"
              onSelect={approve}
            />
            <Item
              testId="worker-send"
              title={`Send to @${id}`}
              detail="Your feedback as a send-back; the lead is told"
              onSelect={send}
            />
            <Item
              testId="worker-merge"
              title="Accept and merge myself"
              disabled={amended}
              detail={`Merges ${head} into ${leadBranch ?? "the lead's branch"} and accepts the claim with its receipts`}
              onSelect={merge}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
};

const STATE_WORDS = { working: "Working", settled: null } as const;

const WorkerPrimary = ({
  subject,
  worker,
}: {
  readonly subject: SessionSubject;
  readonly worker: WorkerAttempt;
}) => {
  const kind = workerActionKind(worker.attempt);
  const word = kind === "review" ? null : STATE_WORDS[kind];

  return (
    <div className="gap-gap flex items-center">
      <span
        data-testid="worker-attempt"
        className="border-hairline rounded-control text-label text-text-default flex h-[30px] items-center border px-3"
      >
        Attempt {attemptNumber(worker)}
      </span>
      {kind === "review" ? (
        <ClaimActions key={worker.attempt.id} subject={subject} worker={worker} />
      ) : null}
      {word === null ? null : (
        <span className="rounded-control text-label bg-fill-selected text-text-subtle flex h-[30px] items-center px-3">
          {word}
        </span>
      )}
    </div>
  );
};

const SessionPrimary = ({
  subject,
  checkout,
}: ReviewSlotProps & { readonly subject: SessionSubject }) => {
  const worker = useWorkerAttempt(subject.hostKey, subject.sessionId);

  return worker === null ? (
    <AcceptAction subject={subject} checkout={checkout} />
  ) : (
    <WorkerPrimary subject={subject} worker={worker} />
  );
};

export const SessionOrWorkerAction = (props: ReviewSlotProps) =>
  props.subject.kind === "session" ? <SessionPrimary {...props} subject={props.subject} /> : null;
