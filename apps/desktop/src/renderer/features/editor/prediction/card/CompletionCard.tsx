/**
 * The tab completion card's body (DESIGN.md, Tab completion status card): the language pill's
 * popover structure (Paper L1/L3), so the status bar's cards read as one family.
 */
import { cn } from "@polaris/ui";
import { useId } from "react";
import { ActionRows, FactRow, Section } from "../../status/cardParts.tsx";
import type { CardAction, CardActionId, CompletionCardView, ModelChoice } from "./model.ts";

export interface Outcome {
  readonly text: string;
  readonly failed: boolean;
}

export interface CompletionCardProps {
  readonly view: CompletionCardView;
  readonly running: { readonly id: CardActionId } | null;
  readonly outcome: Outcome | null;
  readonly titleId: string;
  readonly onRun: (action: CardAction) => void;
  readonly onModel: (model: string | null) => void;
}

const RUNNING: Partial<Record<CardActionId, (label: string) => string>> = {
  "check-again": () => "Checking…",
  "clear-cache": () => "Clearing prompt cache…",
  "reload-model": (label) => `${label.replace(/^Reload/, "Reloading")}…`,
  "turn-on": () => "Turning on…",
  "turn-on-host": () => "Turning on…",
  "turn-off-host": () => "Turning off…",
  "set-up": () => "Starting the download…",
  "cancel-download": () => "Cancelling…",
  "retry-setup": () => "Trying again…",
  "remove-model": () => "Removing…",
  "copy-command": () => "Copying…",
};

const Check = ({ on }: { readonly on: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
    {on ? (
      <path
        d="M3 7.2L5.8 10L11 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : null}
  </svg>
);

const ModelRow = ({
  choice,
  selected,
  onModel,
}: {
  readonly choice: ModelChoice;
  readonly selected: boolean;
  readonly onModel: (model: string | null) => void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    disabled={!choice.enabled}
    title={choice.note ?? choice.label}
    data-model={choice.id ?? "recommended"}
    onClick={() => {
      if (!selected) onModel(choice.id);
    }}
    className={cn(
      "rounded-control text-caption hover:bg-fill-selected focus-visible:bg-fill-selected flex h-[26px] shrink-0 items-center gap-2 px-2 text-left outline-none disabled:hover:bg-transparent",
      choice.enabled ? "text-text-default" : "text-text-faint"
    )}
  >
    <Check on={selected} />
    {/* The name never truncates; the note (a model's name, a reason) gives way first. */}
    <span className="shrink-0">{choice.label}</span>
    {choice.note === null ? null : (
      <span className={cn("ml-auto min-w-0 truncate", choice.enabled && "text-text-subtle")}>
        {choice.note}
      </span>
    )}
  </button>
);

const Models = ({
  models,
  selected,
  onModel,
}: {
  readonly models: ReadonlyArray<ModelChoice>;
  readonly selected: string | null;
  readonly onModel: (model: string | null) => void;
}) => {
  const label = useId();

  return (
    <Section className="gap-1 px-2 pt-2.5 pb-1.5">
      <span className="text-caption text-text-faint px-2" id={label}>
        Model
      </span>
      <div
        role="radiogroup"
        aria-labelledby={label}
        className="flex max-h-[156px] flex-col overflow-y-auto"
        data-testid="completion-models"
      >
        {models.map((choice) => (
          <ModelRow
            key={choice.id ?? "recommended"}
            choice={choice}
            selected={choice.id === selected}
            onModel={onModel}
          />
        ))}
      </div>
    </Section>
  );
};

const Line = ({
  children,
  role,
  strong = false,
}: {
  readonly children: string;
  readonly role?: "status" | "alert";
  readonly strong?: boolean;
}) => (
  <p
    role={role}
    className={cn(
      "text-caption border-hairline border-t px-4 py-2 wrap-anywhere",
      strong ? "text-text-strong" : "text-text-subtle"
    )}
  >
    {children}
  </p>
);

/** The card's width (Paper EP8): wide enough that the Model fact's note, "next edit · recommended", fits. */
export const CARD_WIDTH = "w-[400px]";

export const CompletionCard = ({
  view,
  running,
  outcome,
  titleId,
  onRun,
  onModel,
}: CompletionCardProps) => {
  const actions = view.actions.map((action) => {
    const busy = running?.id === action.id ? RUNNING[action.id] : undefined;

    return busy === undefined ? action : { ...action, label: busy(action.label) };
  });

  return (
    <>
      <div className="flex flex-col gap-1 px-4 pt-3.5 pb-3">
        <h2 id={titleId} className="text-heading-sm text-text-strong">
          {view.title}
        </h2>
        <p className="text-caption text-text-subtle wrap-anywhere">{view.why}</p>
      </div>
      {view.progress === null ? null : (
        <Section className="py-2.5">
          <div
            role="progressbar"
            aria-label="Download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(view.progress * 100)}
            className="bg-fill-selected h-[3px] w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-text-strong h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.max(2, Math.floor(view.progress * 100))}%` }}
            />
          </div>
        </Section>
      )}
      {view.failure === null ? null : (
        <Section>
          <pre className="text-caption text-text-default max-h-24 overflow-auto font-mono leading-[18px] wrap-anywhere whitespace-pre-wrap">
            {view.failure}
          </pre>
        </Section>
      )}
      {view.facts.length === 0 ? null : (
        <Section className="gap-2">
          {view.facts.map((fact) => (
            <FactRow key={fact.label} fact={fact} shortValue />
          ))}
          {view.memory === null ? null : (
            <span className="text-caption text-text-faint" data-testid="completion-memory">
              {view.memory}
            </span>
          )}
        </Section>
      )}
      {view.models === null ? null : (
        <Models models={view.models} selected={view.selectedModel} onModel={onModel} />
      )}
      {view.caption === null ? null : <Line>{view.caption}</Line>}
      {view.advice === null ? null : <Line>{view.advice}</Line>}
      {outcome === null ? null : (
        <Line role={outcome.failed ? "alert" : "status"} strong={outcome.failed}>
          {outcome.text}
        </Line>
      )}
      <ActionRows
        actions={actions}
        running={running}
        autoFocus={false}
        onRun={(row) => {
          const action = view.actions.find((item) => item.id === row.id);

          if (action !== undefined && running === null) onRun(action);
        }}
      />
    </>
  );
};
