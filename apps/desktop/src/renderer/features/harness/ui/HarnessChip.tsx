/**
 * The Harness picker chip (DESIGN.md, Harness picker; artboards 4 and 5): the
 * Harness tile, its handle and Model, opening a menu of the Host's Harnesses
 * (ready or needing sign-in only; the rest under "Other harnesses") and the
 * Harness's Models (its newest four, the rest under "More models…"), the effort bar, a refresh,
 * and its Plan Limits. Picks are staged while the menu is open and sent once when it closes.
 */
import type { HarnessKind } from "@polaris/protocol";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EffortBar,
  effortKey,
  harnessHue,
  HarnessMark,
  HarnessPicker,
} from "@polaris/ui";
import { useRef, useState } from "react";
import { useNow } from "../../../shell/useNow.ts";
import { useAvailability, useHarnessModels, useHarnessRunning, usePlanLimits } from "../live.ts";
import { limitHint, limitsFor } from "../model/limits.ts";
import {
  choose,
  effortFor,
  effortNote,
  type ModelChoice,
  type ModelData,
  modelLabel,
  shortlist,
} from "../model/models.ts";
import { type HarnessOption, listedOptions, STATUS_LABELS } from "../model/options.ts";
import { AvailabilitySheet } from "./Availability.tsx";

export interface HarnessChipProps {
  readonly hostKey: string;
  readonly harness: HarnessKind;
  readonly model: string | null;
  readonly effort: string | null;
  readonly working?: boolean;
  readonly disabled?: boolean;
  /** Picking a Model: `SetModel`, a Fork on it, or the new session's choice. */
  readonly onModel: (choice: ModelChoice) => void;
  /** A line under "Model" saying how a pick takes effect ("Forks a new session"). */
  readonly modelNote?: string | undefined;
  /** Models can't change now (a Turn in flight); the reason replaces the list. */
  readonly modelBlocked?: string | undefined;
  /** Other Harnesses: what picking one does, and its label ("Fork on Codex"). */
  readonly harnesses?: {
    readonly onPick: (option: HarnessOption) => void;
    readonly verb: (option: HarnessOption) => string;
  };
  /** Controls the menu, so `/model` in the composer can open it; uncontrolled when unset. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** What the open menu has picked but not sent yet: committed on close, dropped on Escape. */
interface Staged {
  readonly model: string;
  readonly effort: string | null;
}

const ModelRows = ({
  models,
  shown,
  onStage,
}: {
  readonly models: ReadonlyArray<ModelData>;
  readonly shown: string | null;
  readonly onStage: (model: ModelData) => void;
}) => (
  <DropdownMenuRadioGroup
    value={shown ?? ""}
    onValueChange={(id) => {
      const picked = models.find((m) => m.id === id);

      if (picked !== undefined) onStage(picked);
    }}
  >
    {models.map((m) => (
      <DropdownMenuRadioItem
        key={m.id}
        value={m.id}
        // Picking a Model keeps the menu open, so its effort can follow.
        onSelect={(event) => event.preventDefault()}
        data-testid="model-option"
      >
        {m.name}
      </DropdownMenuRadioItem>
    ))}
  </DropdownMenuRadioGroup>
);

/** DESIGN.md, Harness picker: effort as a dither bar; ←/→ move it, Enter or a click sends it. */
const EffortRow = ({
  harness,
  model,
  effort,
  onStage,
}: {
  readonly harness: HarnessKind;
  readonly model: ModelData;
  readonly effort: string | null;
  readonly onStage: (effort: string) => void;
}) => {
  const level = effortFor(model, effort);
  const index = Math.max(0, model.efforts.indexOf(level ?? ""));
  const note = effortNote(harnessHue(harness).name, model);

  return (
    <>
      <DropdownMenuItem
        className="h-auto flex-col items-stretch gap-1.5 py-2"
        aria-label={`Effort: ${level ?? "none"}. Left and right arrows change it.`}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End"
        data-testid="effort-bar"
        onKeyDown={(event) => {
          const next = effortKey(event.key, index, model.efforts.length);

          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          onStage(model.efforts[next] ?? "");
        }}
      >
        <span className="flex items-baseline">
          <span className="text-caption text-text-subtle">Effort</span>
          <span className="flex-1" />
          <span className="text-caption text-text-strong" data-testid="effort-level">
            {level}
          </span>
        </span>
        <EffortBar
          levels={model.efforts}
          value={index}
          hue={harness}
          onChange={(i) => onStage(model.efforts[i] ?? "")}
        />
      </DropdownMenuItem>
      {note === null ? null : (
        <p className="text-caption text-text-subtle max-w-64 px-2 py-1.5">{note}</p>
      )}
    </>
  );
};

const HarnessItems = ({
  current,
  options,
  harnesses,
}: {
  readonly current: HarnessKind;
  readonly options: ReadonlyArray<HarnessOption>;
  readonly harnesses: NonNullable<HarnessChipProps["harnesses"]>;
}) => (
  <>
    <DropdownMenuLabel>Harness</DropdownMenuLabel>
    {options
      .filter((o) => o.kind !== current)
      .map((option) => (
        <DropdownMenuItem
          key={option.kind}
          onSelect={() => harnesses.onPick(option)}
          data-testid={`pick-harness-${option.kind}`}
        >
          <HarnessMark harness={option.kind} size={20} />
          <span className="flex-1">{harnesses.verb(option)}</span>
          {option.status === "ready" ? (
            option.note === null ? null : (
              <span className="text-caption text-text-subtle pl-3">{option.note}</span>
            )
          ) : (
            <span className="text-caption text-text-subtle pl-3">
              {STATUS_LABELS[option.status]}
            </span>
          )}
        </DropdownMenuItem>
      ))}
  </>
);

const ModelSection = ({
  props,
  staged,
  onStage,
}: {
  readonly props: HarnessChipProps;
  readonly staged: Staged | null;
  readonly onStage: (next: Staged) => void;
}) => {
  const { hostKey, harness, model, effort, modelNote, modelBlocked } = props;
  const models = useHarnessModels(hostKey, harness);
  const { top, more } = shortlist(harness, models.models);
  const shownModel = staged?.model ?? model;
  const shownEffort = staged === null ? effort : staged.effort;
  const selected = models.models.find((m) => m.id === shownModel);
  const stage = (m: ModelData) => onStage({ model: m.id, effort: effortFor(m, shownEffort) });

  return (
    <>
      <DropdownMenuLabel>Model</DropdownMenuLabel>
      {modelNote === undefined ? null : (
        <p className="text-caption text-text-subtle max-w-64 px-2 pb-1.5">{modelNote}</p>
      )}
      {modelBlocked === undefined ? null : (
        <p className="text-caption text-text-subtle max-w-64 px-2 py-1.5">{modelBlocked}</p>
      )}
      {models.loading ? (
        <p className="text-caption text-text-subtle px-2 py-1.5">Loading…</p>
      ) : null}
      {models.error === null ? null : (
        <p className="text-caption text-text-subtle max-w-64 px-2 py-1.5">{models.error}</p>
      )}
      {modelBlocked === undefined ? (
        <>
          <ModelRows models={top} shown={shownModel} onStage={stage} />
          {more.length === 0 ? null : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="more-models">
                <span className="text-text-subtle">More models…</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <ModelRows models={more} shown={shownModel} onStage={stage} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {selected === undefined || selected.efforts.length === 0 ? null : (
            <>
              <DropdownMenuSeparator />
              <EffortRow
                harness={harness}
                model={selected}
                effort={shownEffort}
                onStage={(next) => onStage({ model: selected.id, effort: next })}
              />
            </>
          )}
        </>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          models.refresh();
        }}
        data-testid="refresh-models"
      >
        <span className="text-text-subtle">Refresh models</span>
      </DropdownMenuItem>
    </>
  );
};

const LimitsHint = ({ hostKey, harness }: { hostKey: string; harness: HarnessKind }) => {
  const limits = limitsFor(usePlanLimits(hostKey), harness);
  const now = useNow(60_000);
  const running = useHarnessRunning(hostKey, harness);
  const hint = limitHint(limits, now, running);

  return hint === null ? null : (
    <>
      <DropdownMenuSeparator />
      <p
        className="text-caption text-text-subtle tabular max-w-72 px-2 py-1.5"
        data-testid="plan-limits"
      >
        {hint}
      </p>
    </>
  );
};

export const HarnessChip = (props: HarnessChipProps) => {
  const { hostKey, harness, model, effort, working = false, disabled = false, harnesses } = props;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = props.onOpenChange ?? setOwnOpen;
  const [sheet, setSheet] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const cancelled = useRef(false);
  const models = useHarnessModels(hostKey, harness);
  const { options } = useAvailability(hostKey);

  // One send per opening: what was staged, if it differs from what the session has.
  const commit = () => {
    const picked = models.models.find((m) => m.id === staged?.model);

    if (
      staged !== null &&
      picked !== undefined &&
      (staged.model !== model || staged.effort !== effort)
    )
      props.onModel(choose(picked, staged.effort));
  };

  const onOpenChange = (next: boolean) => {
    if (!next && !cancelled.current) commit();
    setStaged(null);
    cancelled.current = false;
    setOpen(next);
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <HarnessPicker
            harness={harness}
            model={modelLabel(models.models, model, effort)}
            working={working}
            data-testid="model-picker"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-60"
          onEscapeKeyDown={() => {
            cancelled.current = true;
          }}
        >
          <ModelSection props={props} staged={staged} onStage={setStaged} />
          <LimitsHint hostKey={hostKey} harness={harness} />
          {harnesses === undefined ? null : (
            <>
              <DropdownMenuSeparator />
              <HarnessItems
                current={harness}
                options={listedOptions(options)}
                harnesses={harnesses}
              />
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSheet(true)} data-testid="other-harnesses">
            <span className="text-text-subtle">Other harnesses…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AvailabilitySheet hostKey={hostKey} open={sheet} onOpenChange={setSheet} />
    </>
  );
};

/** The chip before a Harness is chosen: while the Host is checked, or when none is ready. */
export const NoHarnessChip = ({ loading }: { readonly loading: boolean }) => (
  <span
    className="rounded-control bg-fill-selected text-caption text-text-subtle inline-flex h-[26px] shrink-0 items-center px-2"
    data-testid="model-picker"
  >
    {loading ? "Checking harnesses…" : "No harness ready"}
  </span>
);
