/**
 * Completion placement (DESIGN.md, Tab completion v1): one row per Host with where its
 * completion is served, then a model lane and a placement lane aligned down the group.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@polaris/ui";
import { Option, Schema } from "effect";
import {
  PredictionPlacementChoice,
  type PredictionPreferences,
} from "../../../../shared/predictionPlacement.ts";
import { FooterStrip, Group, Heading } from "../ui/parts.tsx";
import { modelName } from "../../editor/prediction/store.ts";
import type { PlacementRow } from "./placementRows.ts";

const RECOMMENDED = "recommended";

const MODEL_LANE = "w-[168px]";

/** Radix drops SelectValue's className, so a long model id is truncated from the trigger. */
const TRUNCATE_VALUE = "[&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0";

const PLACEMENT_LANE = "w-[132px]";

export type PreferencesChange = (
  hostKey: string,
  patch: Partial<Pick<PredictionPreferences, "placement" | "model" | "format">>
) => void;

const ModelSelect = ({
  row,
  onChange,
}: {
  readonly row: PlacementRow;
  readonly onChange: PreferencesChange;
}) => (
  <Select
    value={row.model ?? RECOMMENDED}
    disabled={row.placement === "off" || (row.models.length === 0 && row.model === null)}
    onValueChange={(value) =>
      onChange(row.key, { model: value === RECOMMENDED ? null : value, format: null })
    }
  >
    <SelectTrigger
      aria-label={`Completion model for ${row.name}`}
      title={row.model ?? undefined}
      className={`${MODEL_LANE} ${TRUNCATE_VALUE}`}
    >
      <SelectValue>{row.model === null ? "Recommended" : modelName(row.model)}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={RECOMMENDED}>Recommended</SelectItem>
      {row.model !== null && row.modelMissing && (
        <SelectItem value={row.model}>{row.model} · unavailable</SelectItem>
      )}
      {row.models.map((model) => (
        <SelectItem key={model} value={model}>
          {model}
          {/qwen3.*30b/i.test(model) ? " · large, unmeasured" : ""}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const PlacementSelect = ({
  row,
  onChange,
}: {
  readonly row: PlacementRow;
  readonly onChange: PreferencesChange;
}) => (
  <Select
    value={row.placement}
    onValueChange={(value) => {
      const placement = Schema.decodeUnknownOption(PredictionPlacementChoice)(value);

      if (Option.isSome(placement)) onChange(row.key, { placement: placement.value });
    }}
  >
    <SelectTrigger aria-label={`Completion placement for ${row.name}`} className={PLACEMENT_LANE}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="auto">Auto</SelectItem>
      <SelectItem value="client">This machine</SelectItem>
      <SelectItem value="host" disabled={!row.hostCanServe}>
        {row.hostCanServe ? "This host" : "This host · too small"}
      </SelectItem>
      <SelectItem value="off">Off</SelectItem>
    </SelectContent>
  </Select>
);

/** The name and where it's served on the left; the two lanes keep fixed widths so they align. */
const Row = ({
  row,
  onChange,
}: {
  readonly row: PlacementRow;
  readonly onChange: PreferencesChange;
}) => (
  <div
    className="px-panel flex items-center gap-4 py-[calc(var(--spacing-gap)+4px)]"
    data-testid="placement-row"
  >
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-label text-text-default truncate" title={row.name}>
        {row.name}
      </span>
      <span className="text-caption text-text-subtle">{row.caption}</span>
    </div>
    <div className="flex shrink-0 items-center gap-3">
      <ModelSelect row={row} onChange={onChange} />
      <PlacementSelect row={row} onChange={onChange} />
    </div>
  </div>
);

export const CompletionPlacement = ({
  rows,
  memory,
  onChange,
}: {
  readonly rows: ReadonlyArray<PlacementRow>;
  /** The model server memory line; null while unknown. */
  readonly memory: string | null;
  readonly onChange: PreferencesChange;
}) => (
  <div className="gap-gap flex flex-col" data-testid="completion-placement">
    <Heading>Completion placement</Heading>
    <p className="text-caption text-text-subtle">
      Auto uses the stronger machine and falls back to the other. Recommended is Mellum2 on machines
      with 16 GB or more, Qwen2.5-Coder on smaller ones.
    </p>
    <Group label="Completion placement" className="mt-1">
      <div
        className="px-panel text-micro text-text-subtle flex items-center gap-4 py-1.5"
        aria-hidden
      >
        <span className="flex-1">Host</span>
        <span className="flex shrink-0 gap-3">
          <span className={`${MODEL_LANE} pl-2.5`}>Model</span>
          <span className={`${PLACEMENT_LANE} pl-2.5`}>Runs on</span>
        </span>
      </div>
      {rows.map((row) => (
        <Row key={row.key} row={row} onChange={onChange} />
      ))}
      {memory !== null && (
        <FooterStrip>
          <span className="text-caption text-text-subtle" data-testid="model-server-memory">
            {memory}
          </span>
        </FooterStrip>
      )}
    </Group>
  </div>
);
