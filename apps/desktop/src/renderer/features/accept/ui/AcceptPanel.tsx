/**
 * The accept popover (built like Paper R7's Submit review popover, 8XC-0): what is accepted,
 * the drafted commit message (editable), where it's committed, the pull request text, and
 * the account it opens as. ⌘↵ runs it; a failed step can be retried from where it stopped.
 */
import { cn, Input, Textarea } from "@polaris/ui";
import type { ReactNode } from "react";
import type { AcceptBranchChoice } from "../../../../shared/acceptBranch.ts";
import { type AcceptEnd, branchCaption, SUBMIT_LABELS, turnsLabel } from "../model/action.ts";
import { STEP_LABELS } from "../model/flow.ts";
import type { AcceptPanelState, Fields, Plain, AcceptPlan } from "./useAcceptPanel.ts";

const Radio = ({ on }: { readonly on: boolean }) => (
  <span
    aria-hidden="true"
    className={cn(
      "mt-[2px] size-[14px] shrink-0 rounded-full border-solid",
      on ? "border-text-strong border-[4.5px]" : "border-text-faint border-[1.5px]"
    )}
  />
);

const Choice = ({
  on,
  title,
  caption,
  onPick,
  children,
}: {
  readonly on: boolean;
  readonly title: string;
  readonly caption: string;
  readonly onPick: () => void;
  readonly children?: ReactNode;
}) => (
  <div
    role="radio"
    aria-checked={on}
    tabIndex={0}
    onClick={onPick}
    onKeyDown={(e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onPick();
      }
    }}
    className={cn(
      "rounded-control px-gap gap-row-pad flex items-start py-[7px]",
      on && "bg-fill-selected"
    )}
  >
    <Radio on={on} />
    <div className="flex min-w-0 flex-1 flex-col gap-px">
      <span className={cn("text-body", on ? "text-text-strong font-medium" : "text-text-default")}>
        {title}
      </span>
      <span className="text-caption text-text-subtle">{caption}</span>
      {children}
    </div>
  </div>
);

const Check = ({
  checked,
  label,
  caption,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly caption: string;
  readonly onChange: (next: boolean) => void;
}) => (
  <label className="rounded-control px-gap gap-row-pad flex items-start py-[7px]">
    <input
      type="checkbox"
      className="mt-[3px] size-3.5 shrink-0 accent-current"
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
    <span className="flex flex-col gap-px">
      <span className="text-body text-text-default">{label}</span>
      <span className="text-caption text-text-subtle">{caption}</span>
    </span>
  </label>
);

const Section = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="py-row-pad border-hairline flex flex-col gap-[2px] border-t px-[6px]">
    <div className="px-gap text-caption text-text-faint pb-[6px]">{label}</div>
    {children}
  </div>
);

/** The message well: title on one line, body under it (R7's sunken summary). */
const MessageWell = ({
  title,
  body,
  onChange,
  label,
}: {
  readonly title: string;
  readonly body: string;
  readonly onChange: (title: string, body: string) => void;
  readonly label: string;
}) => (
  <div className="bg-surface-sunken border-hairline flex flex-col gap-1 rounded-[8px] border px-3 py-2">
    <Input
      aria-label={`${label} title`}
      data-testid={`accept-${label.replace(/\s+/g, "-")}-title`}
      value={title}
      onChange={(e) => onChange(e.currentTarget.value, body)}
      className="text-body text-text-strong h-auto border-0 bg-transparent px-0 py-0 font-medium shadow-none focus-visible:ring-0"
    />
    <Textarea
      bare
      aria-label={`${label} body`}
      value={body}
      placeholder="Add a description"
      onChange={(e) => onChange(title, e.currentTarget.value)}
      className="text-caption max-h-40 min-h-9"
    />
  </div>
);

const draftCaption = (state: AcceptPanelState, harness: string) => {
  if (state.draft.kind === "loading") return `${harness} is drafting the message…`;

  if (state.draft.kind === "failed") return state.draft.message;

  return state.draft.value.source === "harness"
    ? `Drafted by ${harness}`
    : `From the turns' prompts${state.draft.value.note === null ? "" : ` · ${state.draft.value.note}`}`;
};

const BranchChoices = ({
  plan,
  choice,
  newName,
  onPick,
}: {
  readonly plan: Plain<AcceptPlan>;
  readonly choice: AcceptBranchChoice;
  readonly newName: string;
  readonly onPick: (choice: AcceptBranchChoice) => void;
}) => {
  if (plan.worktree) {
    return (
      <Choice
        on
        title={`Commit to ${plan.branch ?? "HEAD"}`}
        caption="The session works in its own worktree"
        onPick={() => {}}
      />
    );
  }

  const name = choice.kind === "create" ? choice.name : newName;

  return (
    <div role="radiogroup" aria-label="Branch" className="flex flex-col gap-[2px]">
      {plan.branch !== null && (
        <Choice
          on={choice.kind === "current"}
          title={`Commit to ${plan.branch}`}
          caption={
            plan.branch === plan.defaultBranch
              ? "The default branch: no pull request"
              : "The branch checked out now"
          }
          onPick={() => onPick({ kind: "current" })}
        />
      )}
      <Choice
        on={choice.kind === "create"}
        title="New branch"
        caption={`From ${plan.branch ?? "HEAD"}, checked out in place`}
        onPick={() => onPick({ kind: "create", name })}
      >
        {choice.kind === "create" && (
          <Input
            aria-label="Branch name"
            data-testid="accept-branch-name"
            value={choice.name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onPick({ kind: "create", name: e.currentTarget.value })}
            className="text-micro mt-1 h-6 font-mono"
          />
        )}
      </Choice>
    </div>
  );
};

/** The footer's left side: who the pull request opens as, or what pushing uses. */
const accountLine = (end: AcceptEnd | null, login: string | null, owner: string) => {
  if (end === "pull") {
    return login === null ? `Opens the pull request in ${owner}` : `As ${login}, for ${owner}`;
  }

  return end === "push" ? "Pushes with this host's git credentials" : "No remote: commits only";
};

const Footer = ({
  state,
  owner,
}: {
  readonly state: AcceptPanelState;
  readonly owner: string | null;
}) => {
  const { run, end } = state;

  const account = accountLine(end, state.login, owner ?? "GitHub");

  const label =
    run.kind === "running"
      ? `${STEP_LABELS[run.step]}…`
      : run.kind === "failed"
        ? "Try again"
        : end === null
          ? "Accept"
          : SUBMIT_LABELS[end];

  return (
    <div className="py-row-pad gap-gap bg-surface-sunken border-hairline flex items-center border-t px-[14px]">
      <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">{account}</span>
      <button
        type="button"
        data-testid="accept-submit"
        disabled={!state.canSubmit || run.kind === "running"}
        onClick={() => void state.submit()}
        className="h-tree-row px-row-pad rounded-control gap-gap bg-text-strong text-bg text-caption flex items-center font-medium disabled:opacity-(--opacity-dimmed)"
      >
        {label}
        <span className="text-micro opacity-60">⌘↵</span>
      </button>
    </div>
  );
};

export interface AcceptPanelProps {
  readonly state: AcceptPanelState;
  readonly harness: string;
  readonly turns: ReadonlyArray<{ readonly id: string; readonly index: number }>;
  readonly newBranchName: string;
}

const PlanBody = ({
  state,
  plan,
  fields,
  harness,
  newBranchName,
}: {
  readonly state: AcceptPanelState;
  readonly plan: Plain<AcceptPlan>;
  readonly fields: Fields | null;
  readonly harness: string;
  readonly newBranchName: string;
}) => (
  <>
    <div className="flex flex-col gap-1 px-[14px] pb-3">
      {fields === null ? (
        <div className="bg-surface-sunken border-hairline text-caption text-text-subtle rounded-[8px] border px-3 py-2">
          {draftCaption(state, harness)}
        </div>
      ) : (
        <MessageWell
          label="commit"
          title={fields.title}
          body={fields.body}
          onChange={(title, body) => state.setFields({ title, body })}
        />
      )}
      {fields !== null && (
        <span className="text-micro text-text-faint">{draftCaption(state, harness)}</span>
      )}
    </div>
    <div className="pb-row-pad flex flex-col gap-[2px] px-[6px]">
      {state.choice !== null && (
        <BranchChoices
          plan={plan}
          choice={state.choice}
          newName={newBranchName}
          onPick={state.setChoice}
        />
      )}
      {plan.turns.length > 1 && (
        <Check
          checked={state.perTurn}
          onChange={state.setPerTurn}
          label="One commit per turn"
          caption={`${plan.turns.length} commits, titled per turn`}
        />
      )}
      {plan.laterTurns > 0 && (
        <Check
          checked={state.revertLater}
          onChange={state.setRevertLater}
          label={`Undo the ${plan.laterTurns === 1 ? "later turn" : `${plan.laterTurns} later turns`}`}
          caption="Restores the files they changed to this turn's checkpoint"
        />
      )}
    </div>
    {state.end === "pull" && fields !== null && (
      <Section label="Opens with it">
        <div className="px-gap pb-1">
          <MessageWell
            label="pull request"
            title={fields.prTitle}
            body={fields.prBody}
            onChange={(prTitle, prBody) => state.setFields({ prTitle, prBody })}
          />
        </div>
      </Section>
    )}
  </>
);

const Done = ({ state }: { readonly state: AcceptPanelState }) => {
  if (state.run.kind !== "done") return null;
  const { progress } = state.run;
  const commits = progress.commits.length;

  return (
    <div data-testid="accept-done" className="flex flex-col gap-1 px-[14px] pb-[14px]">
      <span className="text-body text-text-default">
        {commits === 0
          ? "Nothing new to commit"
          : `${commits} ${commits === 1 ? "commit" : "commits"} on ${progress.branch ?? "HEAD"}`}
        {progress.done.includes("push") ? ", pushed" : ""}
      </span>
      {progress.pull !== null && (
        <a
          href={progress.pull.url}
          target="_blank"
          rel="noreferrer"
          className="text-caption text-text-subtle underline-offset-2 hover:underline"
        >
          Pull request #{progress.pull.number} opened
        </a>
      )}
    </div>
  );
};

export const AcceptPanel = ({ state, harness, turns, newBranchName }: AcceptPanelProps) => {
  const { plan, run } = state;

  const counts =
    plan.kind === "ready"
      ? `${plan.value.files} ${plan.value.files === 1 ? "file" : "files"} · +${plan.value.additions} −${plan.value.deletions}`
      : null;

  const caption =
    plan.kind === "ready" && state.choice !== null
      ? `${counts} · ${branchCaption(state.choice, plan.value.branch, plan.value.worktree)}`
      : plan.kind === "failed"
        ? plan.message
        : "Reading the turns…";

  return (
    <div
      data-testid="accept-panel"
      className="flex flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void state.submit();
        }
      }}
    >
      <div className="pb-row-pad flex flex-col gap-[2px] px-[14px] pt-[14px]">
        <h2 className="text-heading-sm text-text-strong font-medium">Accept {turnsLabel(turns)}</h2>
        <p
          className={cn(
            "text-caption",
            plan.kind === "failed" ? "text-failed-text" : "text-text-subtle"
          )}
        >
          {caption}
        </p>
      </div>
      {run.kind === "done" ? (
        <Done state={state} />
      ) : (
        plan.kind === "ready" && (
          <PlanBody
            state={state}
            plan={plan.value}
            fields={state.fields}
            harness={harness}
            newBranchName={newBranchName}
          />
        )
      )}
      {run.kind === "failed" && (
        <p role="alert" className="text-caption text-failed-text px-[14px] pb-2">
          {STEP_LABELS[run.step]} failed: {run.message}
        </p>
      )}
      {run.kind !== "done" && plan.kind === "ready" && (
        <Footer state={state} owner={state.repo?.owner ?? null} />
      )}
    </div>
  );
};
