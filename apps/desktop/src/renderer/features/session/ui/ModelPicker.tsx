/**
 * The Harness picker chip opening a Model and effort menu (`harness.models`).
 * A Model with effort levels opens a submenu; the one it runs on is checked.
 * The full Harness picker with availability is task B6.
 */
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
  type Harness,
  HarnessPicker,
} from "@polaris/ui";
import { useState } from "react";
import { useHarnessModels } from "../hooks.ts";
import {
  choose,
  type ModelChoice,
  type ModelData,
  modelLabel,
  pickableModels,
} from "../model/models.ts";

export interface ModelPickerProps {
  readonly hostKey: string;
  readonly harness: Harness;
  readonly model: string | null;
  readonly effort: string | null;
  readonly working?: boolean;
  readonly onChoose: (choice: ModelChoice) => void;
  /** Shown under the menu's title, e.g. "Codex can't switch Model mid-session; picking forks". */
  readonly note?: string | undefined;
  readonly disabled?: boolean;
}

const EffortItems = ({
  model,
  current,
  onChoose,
}: {
  readonly model: ModelData;
  readonly current: string | null;
  readonly onChoose: (choice: ModelChoice) => void;
}) => (
  <DropdownMenuRadioGroup
    value={current ?? model.defaultEffort ?? ""}
    onValueChange={(effort) => onChoose(choose(model, effort))}
  >
    {model.efforts.map((effort) => (
      <DropdownMenuRadioItem key={effort} value={effort}>
        {effort}
        {effort === model.defaultEffort ? (
          <span className="text-caption text-text-faint ml-auto pl-3">default</span>
        ) : null}
      </DropdownMenuRadioItem>
    ))}
  </DropdownMenuRadioGroup>
);

const ModelItem = ({
  model,
  selected,
  effort,
  onChoose,
}: {
  readonly model: ModelData;
  readonly selected: boolean;
  readonly effort: string | null;
  readonly onChoose: (choice: ModelChoice) => void;
}) => {
  const label = (
    <span className={selected ? "text-text-strong" : undefined} data-testid="model-option">
      {model.name}
    </span>
  );

  if (model.efforts.length === 0)
    return <DropdownMenuItem onSelect={() => onChoose(choose(model))}>{label}</DropdownMenuItem>;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <EffortItems model={model} current={selected ? effort : null} onChoose={onChoose} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

export const ModelPicker = ({
  hostKey,
  harness,
  model,
  effort,
  working = false,
  onChoose,
  note,
  disabled = false,
}: ModelPickerProps) => {
  const [open, setOpen] = useState(false);
  const { models, error, loading } = useHarnessModels(hostKey, harness);
  const options = pickableModels(harness, models);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <HarnessPicker
          harness={harness}
          model={modelLabel(models, model, effort)}
          working={working}
          data-testid="model-picker"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        {note === undefined ? null : (
          <p className="text-caption text-text-faint max-w-64 px-2 pb-1.5">{note}</p>
        )}
        <DropdownMenuSeparator />
        {loading ? <p className="text-caption text-text-faint px-2 py-1.5">Loading…</p> : null}
        {error === null ? null : (
          <p className="text-caption text-text-subtle max-w-64 px-2 py-1.5">{error}</p>
        )}
        {options.map((m) => (
          <ModelItem
            key={m.id}
            model={m}
            selected={m.id === model}
            effort={effort}
            onChoose={(choice) => {
              setOpen(false);
              onChoose(choice);
            }}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
