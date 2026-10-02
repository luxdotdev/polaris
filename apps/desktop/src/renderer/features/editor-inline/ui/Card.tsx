/**
 * The inline chat card (DESIGN.md, Editor; Paper E2): the Harness picker chip, the prompt and
 * the selected range; then the footer for its phase. A proposal reads "1 change +2 −1 ·
 * Thought for 4s" with Open as agent session, Reject (esc) and Accept (⌘↵, the one primary).
 */
import type { EditorView } from "@codemirror/view";
import { CheckIcon, cn } from "@polaris/ui";
import type { KeyboardEvent, ReactNode } from "react";
import { acceptCardProposal, closeInlineCard, stopCard, submitCard } from "../actions.ts";
import { HarnessChip } from "../../harness/index.ts";
import { type CardSession, footerOf, isAnswer, isInlineHarness } from "../model/card.ts";
import { rangeLabel } from "../model/patch.ts";
import { patchCard, useCard } from "../store.ts";

export interface CardProps {
  readonly view: EditorView;
  readonly id: number;
  readonly hostKey: string;
  readonly lines: { readonly first: number; readonly last: number };
  /** Null when the Host can't propose (its Daemon predates `inline.propose`). */
  readonly unsupported: string | null;
  readonly onOpenAsSession: (session: CardSession) => void;
}

const BUTTON =
  "flex h-tree-row shrink-0 cursor-default items-center gap-1.5 rounded-control px-row-x text-body font-medium";

const Hint = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-text-subtle text-[11px] leading-3 font-normal">{children}</span>
);

const Button = ({
  children,
  onClick,
  tone = "quiet",
  testId,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly tone?: "quiet" | "secondary" | "primary";
  readonly testId?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className={cn(
      BUTTON,
      tone === "quiet" && "text-text-subtle hover:bg-fill-hover hover:text-text-default",
      tone === "secondary" && "bg-fill-selected text-text-default hover:bg-fill-hover",
      tone === "primary" && "bg-text-strong text-bg px-3"
    )}
  >
    {children}
  </button>
);

const FooterRow = ({ children }: { readonly children: ReactNode }) => (
  <div className="border-hairline gap-gap py-gap pr-row-x flex items-center border-t pl-3">
    {children}
  </div>
);

const Running = ({ id, session }: { readonly id: number; readonly session: CardSession }) => {
  const text = session.phase.kind === "running" ? session.phase.text.trim() : "";

  return (
    <FooterRow>
      <span className="text-caption text-text-subtle shrink-0">Thinking…</span>
      <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">{text}</span>
      <Button onClick={() => stopCard(id)} tone="secondary" testId="inline-stop">
        Stop <Hint>esc</Hint>
      </Button>
    </FooterRow>
  );
};

const Proposed = (props: CardProps & { readonly session: CardSession }) => {
  const { phase } = props.session;

  if (phase.kind !== "proposed") return null;
  const footer = footerOf(phase);
  const answer = isAnswer(phase);

  return (
    <>
      {answer ? (
        <p
          className="border-hairline text-body text-text-default border-t px-3 py-2.5"
          data-testid="inline-answer"
        >
          {phase.patch.summary}
        </p>
      ) : null}
      <FooterRow>
        <CheckIcon size={14} className="text-text-subtle shrink-0" />
        <span className="text-caption text-text-subtle shrink-0" title={phase.patch.summary}>
          {footer.changes}
        </span>
        {answer ? null : (
          <>
            <span className="text-caption text-diff-added-text shrink-0">+{footer.added}</span>
            <span className="text-caption text-diff-removed-text shrink-0">−{footer.removed}</span>
          </>
        )}
        <span className="text-caption text-text-subtle shrink-0" data-testid="inline-thought">
          · {footer.thought}
        </span>
        <span className="flex-1" />
        <Button onClick={() => props.onOpenAsSession(props.session)} testId="inline-open-session">
          Open as agent session
        </Button>
        <Button
          onClick={() => closeInlineCard(props.view, props.id)}
          tone="secondary"
          testId="inline-reject"
        >
          {answer ? "Close" : "Reject"} <Hint>esc</Hint>
        </Button>
        {answer ? null : (
          <Button
            onClick={() => acceptCardProposal(props.view, props.id)}
            tone="primary"
            testId="inline-accept"
          >
            Accept <span className="text-text-faint text-[11px] leading-3 font-normal">⌘↵</span>
          </Button>
        )}
      </FooterRow>
    </>
  );
};

const Notice = (props: CardProps & { readonly text: string; readonly retry: boolean }) => (
  <FooterRow>
    <span
      className={cn(
        "text-caption min-w-0 flex-1",
        props.retry ? "text-failed-text" : "text-text-subtle"
      )}
      data-testid="inline-notice"
    >
      {props.text}
    </span>
    {props.retry ? (
      <Button onClick={() => submitCard(props.view, props.id)} tone="secondary">
        Ask again
      </Button>
    ) : null}
    <Button onClick={() => closeInlineCard(props.view, props.id)}>
      Close <Hint>esc</Hint>
    </Button>
  </FooterRow>
);

const Footer = (props: CardProps & { readonly session: CardSession }) => {
  const { phase } = props.session;

  if (props.unsupported !== null && phase.kind === "draft")
    return <Notice {...props} text={props.unsupported} retry={false} />;

  switch (phase.kind) {
    case "draft":
      return null;
    case "running":
      return <Running id={props.id} session={props.session} />;
    case "proposed":
      return <Proposed {...props} />;
    case "failed":
      return <Notice {...props} text={phase.message} retry />;
    case "stale":
      return <Notice {...props} text="The file changed while it thought" retry />;
  }
};

/** esc rejects, stops or closes; ⌘↵ accepts; ↵ in the prompt asks. Never reaches the editor. */
const onKeys = (props: CardProps, session: CardSession) => (event: KeyboardEvent) => {
  const { phase } = session;

  if (event.key === "Escape") {
    if (phase.kind === "running") stopCard(props.id);
    else closeInlineCard(props.view, props.id);
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && phase.kind === "proposed")
    acceptCardProposal(props.view, props.id);
  else if (
    event.key === "Enter" &&
    !event.shiftKey &&
    phase.kind !== "running" &&
    phase.kind !== "proposed" &&
    props.unsupported === null
  )
    submitCard(props.view, props.id);
  else return;
  event.preventDefault();
  event.stopPropagation();
};

export const Card = (props: CardProps) => {
  const session = useCard(props.id);

  if (session === undefined) return null;
  const locked = session.phase.kind === "running" || session.phase.kind === "proposed";

  return (
    <div
      role="dialog"
      aria-label="Edit or ask"
      data-testid="inline-card"
      data-phase={session.phase.kind}
      onKeyDown={onKeys(props, session)}
      className="rounded-card border-hairline bg-surface-raised shadow-float flex w-full max-w-[760px] flex-col border font-sans"
    >
      <div className="gap-row-x py-row-x pl-row-x flex items-center pr-3">
        <HarnessChip
          hostKey={props.hostKey}
          harness={session.harness}
          model={session.model}
          effort={session.effort}
          disabled={locked}
          onModel={(choice) =>
            patchCard(props.id, () => ({ model: choice.model, effort: choice.effort }))
          }
          harnesses={{
            onPick: ({ kind }) => {
              if (isInlineHarness(kind))
                patchCard(props.id, () => ({ harness: kind, model: null, effort: null }));
            },
            verb: (option) =>
              isInlineHarness(option.kind)
                ? `Use ${option.name}`
                : `${option.name} can't edit inline`,
          }}
        />
        <input
          data-inline-prompt
          data-testid="inline-prompt"
          value={session.prompt}
          readOnly={locked}
          onChange={(event) => patchCard(props.id, () => ({ prompt: event.target.value }))}
          placeholder={`Edit or ask about ${rangeLabel(props.lines.first, props.lines.last)}`}
          aria-label="Prompt"
          className="text-body text-text-strong placeholder:text-text-subtle min-w-0 flex-1 bg-transparent outline-none"
        />
        <span className="text-caption text-text-subtle shrink-0">
          {rangeLabel(props.lines.first, props.lines.last)}
        </span>
      </div>
      <Footer {...props} session={session} />
    </div>
  );
};
