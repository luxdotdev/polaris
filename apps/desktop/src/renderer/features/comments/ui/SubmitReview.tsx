/**
 * "Submit review" and its popover (Paper R7 8XC-0): the summary, Comment / Approve /
 * Request changes with their consequences, what goes out with it (each pending comment and
 * the Viewed count), and the account it goes out as. GitHub's pending review is submitted.
 */
import { Button, cn, Popover, PopoverContent, PopoverTrigger, Textarea } from "@polaris/ui";
import { useState } from "react";
import { useStore } from "zustand";
import type { PullDetailView, ReviewEvent } from "../../../../shared/github.ts";
import {
  emptySurface,
  type ReviewSlotProps,
  subjectKey as keyOf,
  surfaceStore,
} from "../../review/index.ts";
import { discardReview, submitReview } from "../data/actions.ts";
import { useComments } from "../data/store.ts";
import {
  type OpenRisk,
  pendingCaption,
  pendingComments,
  pendingCount,
  SUBMIT_LABEL,
  type SubmitChoice,
  submitChoices,
  submitProblem,
} from "../model/threads.ts";

const ORDER = ["critical", "high", "medium", "low"] as const;

/** The most severe open finding and how many share its Severity. */
const useOpenRisk = (subjectKey: string): OpenRisk | null => {
  const findings = useStore(surfaceStore, (s) => (s[subjectKey] ?? emptySurface).findings);
  const open = findings.filter((f) => f.status === "open");

  for (const severity of ORDER) {
    const count = open.filter((f) => f.severity === severity).length;

    if (count > 0) return { severity, count };
  }

  return null;
};

const Choice = ({
  choice,
  chosen,
  onChoose,
}: {
  readonly choice: SubmitChoice;
  readonly chosen: boolean;
  readonly onChoose: () => void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={chosen}
    disabled={choice.blocked !== null}
    onClick={onChoose}
    data-testid="submit-choice"
    data-event={choice.event}
    className={cn(
      "rounded-control px-gap gap-row-pad flex cursor-default items-start py-[7px] text-left",
      chosen ? "bg-fill-selected" : "hover:bg-fill-hover",
      "disabled:opacity-(--opacity-dimmed)"
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 size-3.5 shrink-0 rounded-full border-solid",
        chosen ? "border-text-strong border-[4.5px]" : "border-text-faint border-[1.5px]"
      )}
    />
    <span className="flex flex-col gap-px">
      <span
        className={cn("text-body", chosen ? "text-text-strong font-medium" : "text-text-default")}
      >
        {choice.label}
      </span>
      <span className="text-caption text-text-subtle">{choice.blocked ?? choice.caption}</span>
    </span>
  </button>
);

const GoesOut = ({ detail }: { readonly detail: PullDetailView }) => {
  const pending = pendingComments(detail);
  const viewed = detail.files.filter((f) => f.viewed === "viewed").length;
  const left = detail.files.length - viewed;

  return (
    <div className="border-hairline flex flex-col gap-0.5 border-t px-1.5 py-2">
      <span className="text-caption text-text-faint px-gap pb-1.5">Goes out with it</span>
      {pending.map((p) => (
        <div key={p.comment.id} className="px-gap gap-row-pad flex h-[26px] items-center">
          <span className="text-text-subtle w-[150px] shrink-0 truncate font-mono text-[11px] leading-4">
            {p.place}
          </span>
          <span className="text-caption text-text-default min-w-0 flex-1 truncate">
            {p.comment.body}
          </span>
        </div>
      ))}
      <div className="px-gap gap-row-pad flex h-[26px] items-center">
        <span className="text-caption text-text-subtle w-[150px] shrink-0">Viewed</span>
        <span className="text-caption text-text-default">
          {viewed} of {detail.files.length} files{left > 0 ? ` · ${left} not viewed yet` : ""}
        </span>
      </div>
    </div>
  );
};

const Dialog = ({
  subjectKey,
  detail,
  onDone,
}: {
  readonly subjectKey: string;
  readonly detail: PullDetailView;
  readonly onDone: () => void;
}) => {
  const risk = useOpenRisk(subjectKey);
  const choices = submitChoices(detail, risk);
  const pending = pendingCount(detail);
  const [event, setEvent] = useState<ReviewEvent>("comment");
  const [body, setBody] = useState("");

  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  const problem = submitProblem(event, body, pending);
  const owner = detail.repo.split("/")[0] ?? detail.repo;

  const submit = async () => {
    if (problem !== null || state.busy) return;
    setState({ busy: true, error: null });
    const done = await submitReview(subjectKey, event, body);

    if (done.ok) onDone();
    else setState({ busy: false, error: done.message });
  };

  return (
    <div className="flex flex-col" data-testid="submit-review">
      <div className="flex flex-col gap-0.5 px-3.5 pt-3.5 pb-2">
        <span className="text-heading-sm text-text-strong font-medium">
          Submit review on #{detail.number}
        </span>
        <span className="text-caption text-text-subtle">{pendingCaption(pending)}</span>
      </div>
      <div className="px-3.5 pb-3">
        <Textarea
          autoFocus
          aria-label="Summary"
          placeholder={
            event === "request-changes" ? "Say what needs to change" : "Leave a summary (optional)"
          }
          className="min-h-[72px]"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
      </div>
      <div role="radiogroup" aria-label="Review" className="flex flex-col gap-0.5 px-1.5 pb-2">
        {choices.map((c) => (
          <Choice
            key={c.event}
            choice={c}
            chosen={c.event === event}
            onChoose={() => setEvent(c.event)}
          />
        ))}
      </div>
      <GoesOut detail={detail} />
      {state.error !== null && (
        <p className="text-caption text-failed-text px-3.5 pb-2">{state.error}</p>
      )}
      <div className="border-hairline bg-surface-sunken gap-gap flex items-center border-t px-3.5 py-2">
        <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
          As {detail.viewerLogin}, for {owner}
        </span>
        {pending > 0 && (
          <Button
            size="xs"
            variant="ghost"
            disabled={state.busy}
            onClick={() => void discardReview(subjectKey).then(onDone)}
          >
            Discard pending
          </Button>
        )}
        <Button
          size="xs"
          variant="primary"
          data-testid="submit-review-send"
          disabled={problem !== null || state.busy}
          title={problem ?? undefined}
          onClick={() => void submit()}
        >
          {SUBMIT_LABEL[event]} <span className="opacity-60">⌘↵</span>
        </Button>
      </div>
    </div>
  );
};

/** The pull request's primary action (DESIGN.md, Review: "Submit review" with the pending count). */
export const SubmitReviewAction = (props: ReviewSlotProps) => {
  const key = keyOf(props.subject);
  const detail = useComments((s) => s.pulls[key]?.detail ?? null);
  const [open, setOpen] = useState(false);
  const pending = pendingCount(detail);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="primary"
          disabled={detail === null || detail.state !== "open"}
          data-testid="submit-review-open"
        >
          Submit review
          {pending > 0 && (
            <span className="text-micro flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-[color-mix(in_oklab,currentColor_12%,transparent)] px-[5px] font-medium">
              {pending}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] overflow-clip p-0">
        {detail !== null && (
          <Dialog subjectKey={key} detail={detail} onDone={() => setOpen(false)} />
        )}
      </PopoverContent>
    </Popover>
  );
};
