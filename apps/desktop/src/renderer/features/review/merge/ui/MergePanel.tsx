/**
 * The merge popover (DESIGN.md, Review → Merge): what blocks it, the method (only what the
 * repository allows), the commit message (editable for merge and squash), the follow-ups,
 * and the account it merges as. ⌘↵ merges. Auto-merge takes the method and message only.
 */
import { Button, cn } from "@polaris/ui";
import { useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import { shortcutLabel } from "../../../../../shared/chord.ts";
import type { MergeMethod, MergeView } from "../../../../../shared/githubActions.ts";
import { FIELD_CHORDS } from "../../../../../shared/keymap.ts";
import type { Held } from "../../checkout/actions.ts";
import {
  disableAutoMerge,
  enableAutoMerge,
  type MergeOutcome,
  mergePull,
} from "../data/actions.ts";
import { setMergePrefs, useMergePrefs } from "../data/prefs.ts";
import {
  blockLong,
  checksCaption,
  firstMethod,
  keepCaption,
  type MergeButton,
  METHOD_LABEL,
  methodCaption,
  submitLabel,
} from "../model/merge.ts";
import type { LinkedSession } from "../model/local.ts";
import { Check, Choice, Initial, MessageWell, Section } from "./parts.tsx";

export interface MergePanelProps {
  readonly pull: OpenPull;
  readonly view: MergeView;
  readonly button: MergeButton;
  readonly commits: number;
  readonly checkout: Held | null;
  readonly session: LinkedSession | null;
  readonly onDone: () => void;
}

type Messages = Readonly<Record<"merge" | "squash", { title: string; body: string }>>;

interface Follow {
  readonly deleteBranch: boolean;
  readonly removeCheckout: boolean;
  readonly archive: boolean;
  readonly deleteLocalBranch: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const Blocks = ({ view }: { readonly view: MergeView }) => (
  <ul data-testid="merge-blocks" className="flex flex-col gap-1 px-[14px] pb-2.5">
    {view.blocks.map((b) => (
      <li
        key={b.kind}
        className={cn(
          "text-caption",
          b.kind === "checks-failing" ? "text-failed-text" : "text-text-default"
        )}
      >
        {blockLong(b)}
      </li>
    ))}
  </ul>
);

const Methods = ({
  view,
  method,
  commits,
  onPick,
}: {
  readonly view: MergeView;
  readonly method: MergeMethod;
  readonly commits: number;
  readonly onPick: (method: MergeMethod) => void;
}) =>
  view.methods.length < 2 ? null : (
    <div
      role="radiogroup"
      aria-label="Merge method"
      className="flex flex-col gap-[2px] px-[6px] pb-2.5"
    >
      {view.methods.map((m) => (
        <Choice
          key={m}
          on={m === method}
          title={METHOD_LABEL[m]}
          caption={methodCaption(m, commits, view.baseRefName)}
          onPick={() => onPick(m)}
          testId={`merge-method-${m}`}
          autoFocus={m === method}
        />
      ))}
    </div>
  );

const FollowUps = ({
  view,
  follow,
  checkout,
  session,
  onChange,
}: {
  readonly view: MergeView;
  readonly follow: Follow;
  readonly checkout: Held | null;
  readonly session: LinkedSession | null;
  readonly onChange: (patch: Partial<Follow>) => void;
}) => {
  const keep = keepCaption(view.branch.keep);

  return (
    <Section label="Then">
      <Check
        testId="merge-delete-branch"
        checked={view.branch.keep === "auto" || (keep === null && follow.deleteBranch)}
        disabled={keep !== null}
        onChange={(deleteBranch) => onChange({ deleteBranch })}
        label={`Delete branch ${view.branch.name}`}
        caption={keep ?? `On GitHub. The toast can restore it`}
      />
      {checkout !== null && (
        <Check
          testId="merge-remove-checkout"
          checked={follow.removeCheckout}
          onChange={(removeCheckout) => onChange({ removeCheckout })}
          label={`Remove the review checkout on ${checkout.hostLabel}`}
          caption="Its worktree and review refs. Local edits or commits keep it"
        />
      )}
      {session !== null && (
        <Check
          testId="merge-archive-session"
          checked={follow.archive}
          onChange={(archive) => onChange({ archive })}
          label={`Archive ${session.title}`}
          caption={`The agent session on ${session.hostLabel}, and the worktree it made`}
        />
      )}
      {session !== null && session.branch !== null && follow.archive && (
        <Check
          testId="merge-delete-local-branch"
          checked={follow.deleteLocalBranch}
          onChange={(deleteLocalBranch) => onChange({ deleteLocalBranch })}
          label={`Delete local branch ${session.branch}`}
          caption="Only if git sees it merged; squash and rebase merges keep it. Can't be undone"
        />
      )}
    </Section>
  );
};

const useRun = (run: () => Promise<MergeOutcome>, onDone: () => void) => {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  const go = async () => {
    if (state.busy) return;
    setState({ busy: true, error: null });
    const outcome = await run();

    if (outcome.ok) onDone();
    else setState({ busy: false, error: outcome.message });
  };

  return { ...state, go };
};

const Footer = ({
  view,
  label,
  disabled,
  busy,
  onSubmit,
}: {
  readonly view: MergeView;
  readonly label: string;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onSubmit: () => void;
}) => (
  <div className="border-hairline bg-surface-sunken gap-gap flex items-center border-t px-3.5 py-2.5">
    <Initial name={view.viewerLogin} />
    <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
      As {view.viewerLogin}, for {view.repo.split("/")[0] ?? view.repo}
    </span>
    <Button
      variant="primary"
      data-testid="merge-submit"
      disabled={disabled || busy}
      onClick={onSubmit}
    >
      {busy ? "Merging…" : label}{" "}
      {!disabled && <span className="opacity-60">{shortcutLabel(FIELD_CHORDS.submit)}</span>}
    </Button>
  </div>
);

/** Auto-merge is on: how it will merge, and the way to turn it off. */
const AutoOn = ({ pull, view, onDone }: Pick<MergePanelProps, "pull" | "view" | "onDone">) => {
  const run = useRun(() => disableAutoMerge(pull, view), onDone);
  const enabled = view.autoMerge.enabled;

  return (
    <div className="flex flex-col" data-testid="merge-panel" data-state="auto-on">
      <div className="flex flex-col gap-[2px] px-[14px] pt-[14px] pb-3">
        <h2 className="text-heading-sm text-text-strong font-medium">
          Auto-merge on for #{view.number}
        </h2>
        <p className="text-caption text-text-subtle">
          GitHub merges it once it can · {METHOD_LABEL[enabled?.method ?? view.defaultMethod]}
          {enabled?.by == null ? "" : ` · turned on by ${enabled.by}`}
        </p>
      </div>
      {view.blocks.length > 0 && <Blocks view={view} />}
      {run.error !== null && (
        <p className="text-caption text-failed-text px-3.5 pb-2">{run.error}</p>
      )}
      <div className="border-hairline bg-surface-sunken flex justify-end border-t px-3.5 py-2.5">
        <Button data-testid="merge-auto-off" disabled={run.busy} onClick={() => void run.go()}>
          Turn off auto-merge
        </Button>
      </div>
    </div>
  );
};

const useForm = (view: MergeView, held: Held | null, session: LinkedSession | null) => {
  const prefs = useMergePrefs(view.viewerLogin);

  const [method, setMethod] = useState(() =>
    firstMethod(view, prefs.methods[view.repo.toLowerCase()])
  );

  const [messages, setMessages] = useState<Messages>(() => ({
    merge: { ...view.messages.merge },
    squash: { ...view.messages.squash },
  }));

  const follow: Follow = {
    deleteBranch: prefs.deleteBranch,
    removeCheckout: prefs.removeCheckout,
    archive: session !== null,
    deleteLocalBranch: prefs.deleteLocalBranch,
  };

  const message = method === "rebase" ? { title: "", body: "" } : messages[method];

  return {
    method,
    setMethod,
    message,
    setMessage: (title: string, body: string) => {
      if (method !== "rebase") setMessages({ ...messages, [method]: { title, body } });
    },
    follow,
    // Archiving is asked each time; the rest is remembered for the account.
    setFollow: (remembered: Partial<Omit<Follow, "archive">>) =>
      setMergePrefs(view.viewerLogin, remembered),
    choice: (archive: boolean) => ({
      view,
      method,
      title: message.title,
      body: message.body,
      deleteBranch: view.branch.keep === null && follow.deleteBranch,
      checkout: follow.removeCheckout ? held : null,
      archive:
        session === null || !archive
          ? null
          : { session, deleteBranch: session.branch !== null && follow.deleteLocalBranch },
    }),
  };
};

const heading = (button: MergeButton, number: number) =>
  button.kind === "auto" ? `Merge #${number} when ready` : `Merge #${number}`;

const Ready = ({ pull, view, button, commits, checkout, session, onDone }: MergePanelProps) => {
  const form = useForm(view, checkout, session);
  const [archive, setArchive] = useState(session !== null);
  const auto = button.kind === "auto";
  const blocked = button.kind === "blocked";
  const empty = form.method !== "rebase" && form.message.title.trim() === "";
  const choice = { pull, ...form.choice(archive) };
  const run = useRun(() => (auto ? enableAutoMerge(choice) : mergePull(choice)), onDone);
  const checks = checksCaption(view);

  const submit = () => {
    if (!blocked && !empty) void run.go();
  };

  return (
    <div
      className="flex flex-col"
      data-testid="merge-panel"
      data-state={button.kind}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex flex-col gap-[2px] px-[14px] pt-[14px] pb-2.5">
        <h2 className="text-heading-sm text-text-strong font-medium">
          {heading(button, view.number)}
        </h2>
        <p className="text-caption text-text-subtle">
          {plural(commits, "commit")} into {view.baseRefName}
          {checks === null ? "" : ` · ${checks}`}
        </p>
      </div>
      {view.blocks.length > 0 && <Blocks view={view} />}
      {!blocked && (
        <>
          <Methods view={view} method={form.method} commits={commits} onPick={form.setMethod} />
          <div className="px-[14px] pb-3">
            {form.method === "rebase" ? (
              <p className="text-caption text-text-subtle">Each commit keeps its own message</p>
            ) : (
              <MessageWell
                title={form.message.title}
                body={form.message.body}
                onChange={form.setMessage}
              />
            )}
          </div>
          {auto ? (
            <Section label="Then">
              <p className="px-gap text-caption text-text-subtle pb-1">
                GitHub merges it once nothing blocks it. The branch and the review checkout stay
                until then.
              </p>
            </Section>
          ) : (
            <FollowUps
              view={view}
              follow={{ ...form.follow, archive }}
              checkout={checkout}
              session={session}
              onChange={({ archive: on, ...remembered }) => {
                if (on === undefined) form.setFollow(remembered);
                else setArchive(on);
              }}
            />
          )}
        </>
      )}
      {run.error !== null && (
        <p role="alert" className="text-caption text-failed-text px-3.5 pb-2">
          {run.error}
        </p>
      )}
      <Footer
        view={view}
        label={blocked ? "Merge blocked" : submitLabel(form.method, auto)}
        disabled={blocked || empty}
        busy={run.busy}
        onSubmit={submit}
      />
    </div>
  );
};

export const MergePanel = (props: MergePanelProps) =>
  props.button.kind === "auto-on" ? (
    <AutoOn pull={props.pull} view={props.view} onDone={props.onDone} />
  ) : (
    <Ready {...props} />
  );
