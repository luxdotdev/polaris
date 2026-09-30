/**
 * The Harness picker chip (DESIGN.md, Harness picker; artboards 4 and 5): the
 * Harness tile, its handle and Model, opening a menu of the Host's Harnesses
 * (ready or needing sign-in only; the rest under "Other harnesses") and the
 * Harness's Models with their efforts, a refresh, and its Plan Limits.
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
  harnessHue,
  HarnessMark,
  HarnessPicker,
} from "@polaris/ui";
import { useState } from "react";
import { useNow } from "../../../shell/useNow.ts";
import { useAvailability, useHarnessModels, usePlanLimits } from "../live.ts";
import { limitHint, limitsFor } from "../model/limits.ts";
import {
  choose,
  effortFor,
  effortNote,
  type ModelChoice,
  type ModelData,
  modelLabel,
  pickableModels,
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
}

const EffortItems = ({
  harnessName,
  model,
  current,
  onModel,
}: {
  readonly harnessName: string;
  readonly model: ModelData;
  readonly current: string | null;
  readonly onModel: (choice: ModelChoice) => void;
}) => {
  const note = effortNote(harnessName, model);

  return (
    <>
      {note === null ? null : (
        <p className="text-caption text-text-faint max-w-64 px-2 py-1.5">{note}</p>
      )}
      <DropdownMenuRadioGroup
        value={effortFor(model, current) ?? ""}
        onValueChange={(effort) => onModel(choose(model, effort))}
      >
        {model.efforts.map((effort) => (
          <DropdownMenuRadioItem key={effort} value={effort} data-testid={`effort-${effort}`}>
            {effort}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
};

const ModelItem = ({
  harnessName,
  model,
  selected,
  effort,
  onModel,
}: {
  readonly harnessName: string;
  readonly model: ModelData;
  readonly selected: boolean;
  readonly effort: string | null;
  readonly onModel: (choice: ModelChoice) => void;
}) => {
  const label = (
    <span className={selected ? "text-text-strong" : undefined} data-testid="model-option">
      {model.name}
    </span>
  );

  if (model.efforts.length === 0)
    return <DropdownMenuItem onSelect={() => onModel(choose(model))}>{label}</DropdownMenuItem>;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <EffortItems
          harnessName={harnessName}
          model={model}
          current={selected ? effort : null}
          onModel={onModel}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
          {option.status === "ready" ? null : (
            <span className="text-caption text-text-faint pl-3">
              {STATUS_LABELS[option.status]}
            </span>
          )}
        </DropdownMenuItem>
      ))}
  </>
);

const ModelSection = ({ props, onPicked }: { props: HarnessChipProps; onPicked: () => void }) => {
  const { hostKey, harness, model, effort, onModel, modelNote, modelBlocked } = props;
  const models = useHarnessModels(hostKey, harness);
  const name = harnessHue(harness).name;

  return (
    <>
      <DropdownMenuLabel>Model</DropdownMenuLabel>
      {modelNote === undefined ? null : (
        <p className="text-caption text-text-faint max-w-64 px-2 pb-1.5">{modelNote}</p>
      )}
      {modelBlocked === undefined ? null : (
        <p className="text-caption text-text-subtle max-w-64 px-2 py-1.5">{modelBlocked}</p>
      )}
      {models.loading ? <p className="text-caption text-text-faint px-2 py-1.5">Loading…</p> : null}
      {models.error === null ? null : (
        <p className="text-caption text-text-subtle max-w-64 px-2 py-1.5">{models.error}</p>
      )}
      {modelBlocked === undefined
        ? pickableModels(harness, models.models).map((m) => (
            <ModelItem
              key={m.id}
              harnessName={name}
              model={m}
              selected={m.id === model}
              effort={effort}
              onModel={(choice) => {
                onPicked();
                onModel(choice);
              }}
            />
          ))
        : null}
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
  const hint = limitHint(limits, now);

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
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const models = useHarnessModels(hostKey, harness);
  const { options } = useAvailability(hostKey);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <HarnessPicker
            harness={harness}
            model={modelLabel(models.models, model, effort)}
            working={working}
            data-testid="model-picker"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-60">
          <ModelSection props={props} onPicked={() => setOpen(false)} />
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
