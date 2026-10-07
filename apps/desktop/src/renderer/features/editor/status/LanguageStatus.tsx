/**
 * The status bar's language pill and its popover (DESIGN.md, Editor: Language status; Paper L1,
 * L3). The pill is the one place these states live: no toasts, and the popover ends in Restart
 * or Show log.
 */
import type * as P from "@polaris/protocol";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@polaris/ui";
import { Match } from "effect";
import { useId, useState, type ReactNode } from "react";
import { hostInSentence } from "../../../shell/hostCopy.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { fileKey } from "../model/drafts.ts";
import type { LanguageId } from "../model/language.ts";
import { editorLanguages } from "../runtime/app.ts";
import { useTrustStatus } from "../trust/store.ts";
import { runAction } from "./actions.ts";
import { useHostToolsWatch, useLanguageStatus } from "./hooks.ts";
import { openLanguageLog } from "../intents/languageLog.ts";
import "./intent.ts";
import type { Fact, Mark, StatusAction, StatusView } from "./model.ts";

export const PillMark = ({ mark }: { readonly mark: Mark }) =>
  mark === "none" ? null : (
    <span
      aria-hidden
      data-mark={mark}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        mark === "filled" && "bg-text-subtle",
        mark === "hollow" && "border-text-subtle border",
        mark === "failed" && "bg-failed"
      )}
    />
  );

const FactRow = ({ fact }: { readonly fact: Fact }) => (
  <div className="text-caption flex items-center gap-2">
    <span className="text-text-faint w-[84px] shrink-0">{fact.label}</span>
    <span className={cn("text-text-default min-w-0 truncate", fact.mono && "font-mono")}>
      {fact.value}
    </span>
    {fact.note === undefined ? null : (
      <span className="text-text-subtle shrink-0">{fact.note}</span>
    )}
  </div>
);

const Section = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("border-hairline flex flex-col border-t px-4 py-3", className)}>
    {children}
  </div>
);

const CommandBlock = ({ host, command }: { readonly host: string; readonly command: string }) => {
  const [copied, setCopied] = useState(false);

  return (
    <Section className="gap-1.5">
      <span className="text-caption text-text-faint">Run on {host}</span>
      <div className="rounded-control border-hairline bg-surface-sunken flex h-8 items-center justify-between border pr-1.5 pl-2.5">
        <code className="text-caption text-text-default truncate font-mono">{command}</code>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(command)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
          className="bg-fill-selected text-caption text-text-default focus-visible:outline-starlight h-[22px] shrink-0 rounded-[4px] px-2 focus-visible:outline-2"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </Section>
  );
};

const ProgressBlock = ({
  progress,
}: {
  readonly progress: NonNullable<StatusView["progress"]>;
}) => (
  <Section className="gap-1.5">
    <div
      role="progressbar"
      aria-label="Download"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.fraction === null ? undefined : Math.round(progress.fraction * 100)}
      className="bg-fill-selected flex h-1 overflow-hidden rounded-full"
    >
      <span
        className="bg-text-subtle h-1 w-full origin-left rounded-full transition-transform duration-160 ease-out"
        style={{ transform: `scaleX(${progress.fraction ?? 0.1})` }}
      />
    </div>
    <div className="text-caption flex justify-between gap-2">
      <span className="text-text-default truncate font-mono">{progress.tool}</span>
      <span className="text-text-subtle shrink-0">{progress.amount}</span>
    </div>
  </Section>
);

/** Inline failure copy, chosen by the error's typed reason. */
export const actionFailure = (error: P.LanguageError, host: string) =>
  Match.value(error.reason).pipe(
    Match.when("conflict", () => `It changed on ${host} meanwhile. Try again.`),
    Match.when("not-connected", () => `Can't reach ${host}. Try again when it's back.`),
    Match.when("timeout", () => `No answer from ${host} in time. Try again.`),
    Match.orElse(() => `That didn't work on ${host}. Try again, or check the log.`)
  );

type Running = { readonly id: StatusAction["id"] } | null;

const ActionRows = ({
  actions,
  running,
  onRun,
}: {
  readonly actions: readonly StatusAction[];
  readonly running: Running;
  readonly onRun: (action: StatusAction) => void;
}) => (
  <div className="border-hairline flex flex-col border-t p-1.5" role="menu">
    {actions.map((action, index) => (
      <button
        key={action.id}
        type="button"
        role="menuitem"
        data-action={action.id}
        aria-busy={running?.id === action.id}
        aria-disabled={running !== null}
        autoFocus={index === 0}
        onClick={() => onRun(action)}
        className={cn(
          "rounded-control text-body text-text-default hover:bg-fill-selected hover:text-text-strong focus-visible:bg-fill-selected focus-visible:text-text-strong flex h-[30px] shrink-0 items-center justify-between gap-3 px-2.5 text-left outline-none",
          running !== null && running.id !== action.id && "opacity-55"
        )}
      >
        <span className="truncate">{action.label}</span>
        {action.hint === undefined ? null : (
          <span className="text-caption text-text-faint shrink-0 font-mono">{action.hint}</span>
        )}
      </button>
    ))}
  </div>
);

export interface StatusPopoverProps {
  readonly view: StatusView;
  readonly running: Running;
  readonly failure: string | null;
  readonly onRun: (action: StatusAction) => void;
  readonly titleId: string;
}

/** The popover's body (Paper L1/L3): state sentence and why, facts, then the action rows. */
export const StatusPopover = ({ view, running, failure, onRun, titleId }: StatusPopoverProps) => (
  <>
    <div className="flex flex-col gap-1 px-4 pt-3.5 pb-3">
      <h2
        id={titleId}
        className={cn(
          "text-heading-sm",
          view.tone === "failed" ? "text-failed-text" : "text-text-strong"
        )}
      >
        {view.title}
      </h2>
      <p className="text-caption text-text-subtle">{view.why}</p>
    </div>
    {view.progress === null ? null : <ProgressBlock progress={view.progress} />}
    {view.stderr === null ? null : (
      <Section>
        <pre className="text-caption text-text-default max-h-40 overflow-auto font-mono leading-[18px] whitespace-pre-wrap">
          {view.stderr}
        </pre>
      </Section>
    )}
    {view.command === null || view.commandHost === null ? null : (
      <CommandBlock host={view.commandHost} command={view.command} />
    )}
    {view.facts.length === 0 ? null : (
      <Section className="gap-2">
        {view.facts.map((fact) => (
          <FactRow key={fact.label} fact={fact} />
        ))}
      </Section>
    )}
    {failure === null ? null : (
      <p role="alert" className="text-caption text-text-strong border-hairline border-t px-4 py-2">
        {failure}
      </p>
    )}
    {view.actions.length === 0 ? null : (
      <ActionRows actions={view.actions} running={running} onRun={onRun} />
    )}
  </>
);

export const LanguagePill = ({
  view,
  open,
}: {
  readonly view: Pick<StatusView, "mark" | "pill" | "kind">;
  readonly open?: boolean;
}) => (
  <span
    data-testid="language-pill"
    data-kind={view.kind}
    className={cn(
      "text-caption text-text-strong flex h-5 items-center gap-1.5 rounded-[4px] px-[7px]",
      open ? "bg-fill-selected" : "bg-fill-selected/0 hover:bg-fill-selected"
    )}
  >
    <PillMark mark={view.mark} />
    <span className="truncate">{view.pill}</span>
  </span>
);

export interface LanguageStatusProps {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly language: string;
  readonly languageId: LanguageId;
  /** The manual language choice, shown at the popover's foot. */
  readonly languageMode?: ReactNode;
}

export const LanguageStatus = ({
  hostKey,
  workspaceId,
  path,
  language,
  languageId,
  languageMode,
}: LanguageStatusProps) => {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<Running>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const titleId = useId();
  const view = useLanguageStatus(hostKey, workspaceId, path, language);
  const trust = useTrustStatus(fileKey(hostKey, path));
  const { openSettings } = useShellActions();
  const host = hostInSentence(useApp((s) => s.hosts.find((h) => h.key === hostKey)));
  useHostToolsWatch(hostKey, open || view.kind === "setting-up");

  const providerId = view.providerId ?? view.file?.providers[0]?.providerId ?? null;
  const checkout = view.file?.checkout ?? null;

  const onRun = (action: StatusAction) => {
    if (running !== null) return;
    setFailure(null);
    setRunning({ id: action.id });
    runAction(
      action.id,
      { hostKey, path, checkout, providerId, trust },
      {
        api: polaris().languages,
        recheck: () => editorLanguages?.recheck(fileKey(hostKey, path)),
        showLog: () => {
          if (checkout !== null)
            openLanguageLog({
              hostKey,
              workspaceId,
              checkout,
              language: languageId,
              providerId,
              path,
            });
        },
        openSettings: () => openSettings("editor"),
      }
    )
      .then(() => {
        if (action.id !== "restart" && action.id !== "check-again") setOpen(false);
      })
      .catch((error: P.LanguageError) => setFailure(actionFailure(error, host)))
      .finally(() => setRunning(null));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) setFailure(null);
      }}
    >
      <PopoverTrigger
        aria-label={`Language: ${view.pill}`}
        className="focus-visible:outline-starlight rounded-[4px] focus-visible:outline-2"
      >
        <LanguagePill view={view} open={open} />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        aria-labelledby={titleId}
        data-testid="language-popover"
        onOpenAutoFocus={(event) => {
          // Focus the first action row; with none, keep focus off the language mode field.
          if (view.actions.length === 0) event.preventDefault();
        }}
        data-kind={view.kind}
        className={cn(
          "rounded-row flex flex-col overflow-hidden p-0",
          view.kind === "ready" || view.kind === "bundled" ? "w-[348px]" : "w-[318px]"
        )}
      >
        <StatusPopover
          view={view}
          running={running}
          failure={failure}
          onRun={onRun}
          titleId={titleId}
        />
        {languageMode === undefined ? null : (
          <div className="border-hairline text-caption text-text-faint flex items-center gap-2 border-t px-4 py-2">
            {languageMode}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
