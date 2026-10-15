/**
 * Settings → Editor → Tab completion → the edit prediction rows (DESIGN.md, Edit Predictions EP7;
 * spec §7): Display, Aggressiveness, Accept key and Off for a language, kept the same on every
 * Host, and the outcome log's "Clear history".
 */
import {
  Button,
  Kbd,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polaris/ui";
import { useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { chordOf } from "../../../../shared/keymap.ts";
import { currentKeyPlatform, modifierLabel } from "../../../../shared/chord.ts";
import {
  PREDICTION_ACCEPT_BINDING,
  type PredictionAggressiveness,
  type PredictionPreferences,
} from "../../../../shared/predictionPlacement.ts";
import { polaris } from "../../bridge.ts";
import { LANGUAGE_IDS, LANGUAGES, type LanguageId } from "../../editor/model/language.ts";
import {
  preferencesOf,
  setPreferencesEverywhere,
  usePrediction,
} from "../../editor/prediction/store.ts";
import { SettingRow } from "../ui/parts.tsx";

type Display = PredictionPreferences["display"];

const DISPLAY: ReadonlyArray<{ readonly value: Display; readonly label: string }> = [
  { value: "full", label: "Full" },
  { value: "subtle", label: "Subtle" },
];

const AGGRESSIVENESS: ReadonlyArray<{
  readonly value: PredictionAggressiveness;
  readonly label: string;
}> = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "eager", label: "Eager" },
];

const ADD = "add-language";

/** The binding's key as the editor's hint spells it ("Tab"), not the menu glyph. */
const acceptKey = () => chordOf(PREDICTION_ACCEPT_BINDING, currentKeyPlatform()) ?? "Tab";

const isLanguageId = (value: string): value is LanguageId =>
  LANGUAGE_IDS.some((id) => id === value);

/** Each machine keeps its own copy of these preferences; the rows read the local one and set all. */
const keysOf = (hosts: ReadonlyArray<HostView>) => {
  const keys = hosts.map((host) => host.key);

  return keys.includes("local") ? keys : ["local", ...keys];
};

export const EditPredictionRows = ({
  hosts,
  onError,
}: {
  readonly hosts: ReadonlyArray<HostView>;
  readonly onError: (message: string | null) => void;
}) => {
  const loaded = usePrediction((state) => state.loaded);
  const local = hosts.find((host) => host.kind === "local")?.key ?? "local";
  const preferences = usePrediction((state) => state.preferences[local]) ?? preferencesOf(local);

  const set = (patch: Partial<PredictionPreferences>) =>
    setPreferencesEverywhere(polaris(), keysOf(hosts), patch).then(
      () => onError(null),
      (cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause))
    );

  const disabled = preferences.disabledLanguages.filter(isLanguageId);
  const offered = LANGUAGE_IDS.filter((id) => id !== "plain" && !disabled.includes(id));

  return (
    <>
      <SettingRow
        title="Display"
        caption={`Full shows the edit in place. Subtle shows a marker; hold ${modifierLabel("Alt")} to preview.`}
      >
        <SegmentedControl
          variant="well"
          aria-label="Display"
          options={DISPLAY}
          value={preferences.display}
          onValueChange={(display) => void set({ display })}
        />
      </SettingRow>
      <SettingRow
        title="Aggressiveness"
        caption="Pause length, how far jumps reach, and whether deletions over 5 lines are offered."
      >
        <SegmentedControl
          variant="well"
          aria-label="Aggressiveness"
          options={AGGRESSIVENESS}
          value={preferences.aggressiveness}
          onValueChange={(aggressiveness) => void set({ aggressiveness })}
        />
      </SettingRow>
      <SettingRow
        title="Accept key"
        caption="Tab by default. Remapping it waits for a Keyboard page in Settings."
      >
        <Kbd aria-label={`Accept key: ${acceptKey()}`}>{acceptKey()}</Kbd>
      </SettingRow>
      <div className="px-panel flex flex-col gap-2 py-[calc(var(--spacing-gap)+4px)]">
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label font-regular text-text-default">Off for a language</span>
            <span className="text-caption text-text-subtle">
              No predictions in these languages. Everything else stays on.
            </span>
          </div>
          <Select
            value={ADD}
            disabled={!loaded || offered.length === 0}
            onValueChange={(value) => {
              if (isLanguageId(value)) void set({ disabledLanguages: [...disabled, value] });
            }}
          >
            <SelectTrigger aria-label="Add language" className="w-[168px]">
              <SelectValue>Add language</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ADD} className="hidden">
                Add language
              </SelectItem>
              {offered.map((id) => (
                <SelectItem key={id} value={id}>
                  {LANGUAGES[id].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {disabled.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Languages with tab completion off">
            {disabled.map((id) => (
              <li
                key={id}
                className="bg-row-selected rounded-control text-caption text-text-default flex h-[26px] items-center gap-1 pr-1 pl-2"
              >
                {LANGUAGES[id].name}
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Turn tab completion back on for ${LANGUAGES[id].name}`}
                  onClick={() =>
                    void set({ disabledLanguages: disabled.filter((item) => item !== id) })
                  }
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
};

/** The outcome log behind the status card's counts (spec §8); one button, no confirmation. */
export const ClearHistoryRow = () => {
  const [state, setState] = useState<"idle" | "clearing" | "cleared" | "failed">("idle");

  const clear = () => {
    setState("clearing");
    void polaris()
      .request("prediction.outcomes.clear", {})
      .then((result) => setState(result.ok ? "cleared" : "failed"));
  };

  return (
    <SettingRow
      title="Clear edit prediction history"
      caption="The counts on the status card. Kept on this machine, never uploaded."
    >
      {state === "cleared" && (
        <span role="status" className="text-caption text-text-subtle">
          Cleared
        </span>
      )}
      {state === "failed" && (
        <span role="alert" className="text-caption text-text-strong">
          Couldn't clear it
        </span>
      )}
      <Button variant="secondary" size="sm" disabled={state === "clearing"} onClick={clear}>
        {state === "clearing" ? "Clearing…" : "Clear history"}
      </Button>
    </SettingRow>
  );
};
