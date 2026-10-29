/**
 * The tab completion card (DESIGN.md, Menus and popovers; Paper X-F 10): an instrument card with
 * "Tab completion", its state and the host's switch; the hero of keystrokes to the model server;
 * a readout well and the model list; the footer's status line, Check again and Settings.
 */
import { Button, cn, InstrumentCard, Kicker, Switch } from "@polaris/ui";
import { type ReactNode, useId } from "react";
import { FactRow } from "../../status/cardParts.tsx";
import { Hero } from "./Hero.tsx";
import {
  footerActions,
  footerStatus,
  heroOf,
  hostSwitch,
  readout,
  stateWord,
} from "./instrument.ts";
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
  /** The open file's name, for the hero's editor. */
  readonly file?: string | null | undefined;
  readonly className?: string | undefined;
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
      "text-label hover:bg-fill-selected focus-visible:bg-fill-selected aria-checked:bg-fill-selected flex h-[30px] shrink-0 items-center gap-2 rounded-full px-3 text-left outline-none disabled:hover:bg-transparent",
      choice.enabled ? "text-text-default" : "text-text-faint"
    )}
  >
    {/* The name never truncates; the note (a model's name, a reason) gives way first. */}
    <span className="shrink-0">{choice.label}</span>
    {choice.note === null ? null : (
      <span
        className={cn(
          "min-w-0 truncate font-mono text-[11px]",
          choice.enabled && "text-text-subtle"
        )}
      >
        {choice.note}
      </span>
    )}
    <span className="ml-auto" />
    <Check on={selected} />
  </button>
);

const Models = ({
  models,
  selected,
  placement,
  onModel,
}: {
  readonly models: ReadonlyArray<ModelChoice>;
  /** "On Mac Studio · auto": where the models run. */
  readonly placement: string | null;
  readonly selected: string | null;
  readonly onModel: (model: string | null) => void;
}) => {
  const label = useId();

  return (
    <div className="flex flex-col gap-1 p-1.5">
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-0.5">
        <Kicker id={label}>Model</Kicker>
        {placement === null ? null : <Kicker>{placement}</Kicker>}
      </div>
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
    </div>
  );
};

const Line = ({
  children,
  role,
  strong = false,
  mono = false,
}: {
  readonly children: string;
  readonly role?: "status" | "alert";
  readonly strong?: boolean;
  readonly mono?: boolean;
}) => (
  <p
    role={role}
    className={cn(
      "wrap-anywhere",
      mono ? "text-code-inline font-mono" : "text-caption",
      strong ? "text-text-strong" : "text-text-subtle"
    )}
  >
    {children}
  </p>
);

/** The card's width (Paper X-F 10). */
export const CARD_WIDTH = "w-[400px]";

const working = (view: CompletionCardView) => view.kind === "ready" || view.kind === "serving";

const Readout = ({ view }: { readonly view: CompletionCardView }) => {
  const { cells, details } = readout(view.facts);

  return (
    <>
      {cells.length === 0 ? null : (
        <div
          className="divide-hairline grid grid-cols-3 divide-x py-3"
          data-testid="completion-readout"
        >
          {cells.map((cell) => (
            <div key={cell.label} className="flex min-w-0 flex-col gap-1 px-3.5">
              <Kicker>{cell.label}</Kicker>
              <span className="text-text-strong tabular text-[22px] leading-7 font-medium">
                {cell.value}
              </span>
              <span className="text-caption text-text-subtle">{cell.note}</span>
            </div>
          ))}
        </div>
      )}
      {details.length === 0 && view.memory === null ? null : (
        <div className="border-hairline flex flex-col gap-2 border-t px-3.5 py-3 first:border-t-0">
          {details.map((fact) => (
            <FactRow key={fact.label} fact={fact} shortValue />
          ))}
          {view.memory === null ? null : (
            <span className="text-caption text-text-subtle" data-testid="completion-memory">
              {view.memory}
            </span>
          )}
        </div>
      )}
    </>
  );
};

/** What the card says above the details: the readout's caption, or the headline and why. */
const Headline = ({ view }: { readonly view: CompletionCardView }) => {
  if (view.kind === "failed") return <Line strong>{view.advice ?? view.why}</Line>;

  if (!working(view))
    return (
      <>
        <h3 className="text-heading-sm text-text-strong">{view.title}</h3>
        <Line>{view.why}</Line>
      </>
    );

  return readout(view.facts).cells.length > 0 ? null : <Line>{view.why}</Line>;
};

/** The status well: the readout while it serves, else the headline, why, and what went wrong. */
const StatusWell = ({
  view,
  outcome,
}: {
  readonly view: CompletionCardView;
  readonly outcome: Outcome | null;
}) => (
  <div className="flex flex-col">
    {working(view) ? <Readout view={view} /> : null}
    <div className="flex flex-col gap-1.5 px-3.5 py-3 empty:hidden">
      <Headline view={view} />
      {view.progress === null ? null : <Progress share={view.progress} />}
      {view.failure === null ? null : <Failure text={view.failure} />}
      {view.caption === null ? null : <Line>{view.caption}</Line>}
      {view.advice === null || view.kind === "failed" ? null : <Line>{view.advice}</Line>}
      {outcome === null ? null : (
        <Line role={outcome.failed ? "alert" : "status"} strong={outcome.failed}>
          {outcome.text}
        </Line>
      )}
    </div>
  </div>
);

const Progress = ({ share }: { readonly share: number }) => (
  <div
    role="progressbar"
    aria-label="Download"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.floor(share * 100)}
    className="bg-fill-selected my-1 h-[3px] w-full overflow-hidden rounded-full"
  >
    <div
      className="bg-text-strong h-full rounded-full transition-[width] duration-300"
      style={{ width: `${Math.max(2, Math.floor(share * 100))}%` }}
    />
  </div>
);

const Failure = ({ text }: { readonly text: string }) => (
  <pre className="text-code-inline text-text-default max-h-24 overflow-auto font-mono wrap-anywhere whitespace-pre-wrap">
    {text}
  </pre>
);

const label = (action: CardAction, running: CompletionCardProps["running"]) => {
  const busy = running?.id === action.id ? RUNNING[action.id] : undefined;

  return busy === undefined ? action.label : busy(action.label);
};

/** The footer's status line with its quieter actions under it, Settings last. */
const FooterStatus = ({
  view,
  links,
  running,
  onRun,
}: {
  readonly view: CompletionCardView;
  readonly links: ReadonlyArray<CardAction>;
  readonly running: CompletionCardProps["running"];
  readonly onRun: (action: CardAction) => void;
}) => (
  <span className="flex min-w-0 flex-col items-start gap-1 py-1">
    <span className="max-w-full whitespace-normal" data-testid="completion-status-line">
      {footerStatus(view)}
    </span>
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-sans tracking-normal normal-case">
      {links.map((action) => (
        <button
          key={action.id}
          type="button"
          data-action={action.id}
          aria-busy={running?.id === action.id}
          aria-disabled={running !== null}
          onClick={() => onRun(action)}
          className="text-caption text-text-subtle hover:text-text-default focus-visible:outline-starlight cursor-default rounded-sm underline decoration-(--color-hairline) underline-offset-2 focus-visible:outline-2"
        >
          {label(action, running)}
        </button>
      ))}
    </span>
  </span>
);

const headerOf = ({
  view,
  titleId,
  running,
  onRun,
}: Pick<CompletionCardProps, "view" | "titleId" | "running" | "onRun">) => {
  const toggle = hostSwitch(view);
  const state = stateWord(view);

  return {
    title: <span id={titleId}>Tab completion</span>,
    state: (
      <span
        className={cn(view.kind === "failed" && "text-failed-text")}
        data-testid="completion-state"
      >
        {view.kind === "failed" ? "✕ " : ""}
        {state}
      </span>
    ),
    control:
      toggle === null ? undefined : (
        <label className="text-caption text-text-subtle flex shrink-0 items-center gap-2">
          {toggle.label}
          <Switch
            checked={toggle.on}
            disabled={running !== null}
            aria-label={toggle.label}
            data-action={toggle.action.id}
            onCheckedChange={() => onRun(toggle.action)}
          />
        </label>
      ),
  } satisfies {
    readonly title: ReactNode;
    readonly state: ReactNode;
    readonly control?: ReactNode;
  };
};

export const CompletionCard = ({
  view,
  running,
  outcome,
  titleId,
  file = null,
  className,
  onRun,
  onModel,
}: CompletionCardProps) => {
  const hero = heroOf(view);
  const { primary, links } = footerActions(view);
  const status = <StatusWell view={view} outcome={outcome} />;

  const run = (action: CardAction) => {
    if (running === null) onRun(action);
  };

  const placement = view.target === null ? null : `On ${view.target.machine}`;

  return (
    <InstrumentCard
      className={cn(CARD_WIDTH, className)}
      data-testid="completion-instrument"
      header={headerOf({ view, titleId, running, onRun: run })}
      hero={hero === null ? undefined : <Hero hero={hero} file={file} />}
      wells={
        view.models === null
          ? [status]
          : [
              status,
              <Models
                key="models"
                models={view.models}
                selected={view.selectedModel}
                placement={placement}
                onModel={onModel}
              />,
            ]
      }
      footer={{
        status: <FooterStatus view={view} links={links} running={running} onRun={run} />,
        action:
          primary === null ? undefined : (
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 rounded-full"
              data-action={primary.id}
              aria-busy={running?.id === primary.id}
              disabled={running !== null && running.id !== primary.id}
              onClick={() => run(primary)}
            >
              {label(primary, running)}
            </Button>
          ),
      }}
    />
  );
};
