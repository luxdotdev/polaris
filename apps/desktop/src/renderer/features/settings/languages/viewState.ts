import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageSettingsAdapter, LanguageSettingsSnapshot } from "./contracts.ts";

type Record = typeof P.LanguageSettingsRecord.Type;

const equal = Schema.toEquivalence(P.LanguageSettingsPatch);

export interface SettingsViewState {
  readonly snapshot: LanguageSettingsSnapshot | null;
  readonly adapter: LanguageSettingsAdapter | null;
  readonly scopeKey: string;
  readonly epoch: number;
  readonly valid: boolean;
  readonly baseline: Record | null;
  readonly draft: P.LanguageSettingsPatch;
  readonly acknowledged: {
    readonly adapter: LanguageSettingsAdapter;
    readonly settings: P.LanguageSettingsPatch;
  } | null;
  readonly editingEpoch: number;
}

export const initialSettingsView = (): SettingsViewState => ({
  snapshot: null,
  adapter: null,
  scopeKey: "",
  epoch: -1,
  valid: false,
  baseline: null,
  draft: {},
  acknowledged: null,
  editingEpoch: 0,
});

export const settingsDraftDirty = (view: SettingsViewState) =>
  view.baseline !== null && !equal(view.draft, view.baseline.settings);

export const currentSettingsFacts = (
  view: SettingsViewState,
  adapter: LanguageSettingsAdapter,
  scopeKey: string,
  epoch: number
) =>
  view.valid && view.adapter === adapter && view.scopeKey === scopeKey && view.epoch === epoch
    ? view.snapshot
    : null;

export const settingsRevisionConflict = (view: SettingsViewState) =>
  view.baseline !== null &&
  view.snapshot !== null &&
  (view.baseline.revision !== view.snapshot.record.revision ||
    !equal(view.baseline.settings, view.snapshot.record.settings));

/** Only confirmed matching saves or a clean draft adopt a newly observed record. */
export const acceptSettingsFacts = (
  view: SettingsViewState,
  snapshot: LanguageSettingsSnapshot,
  adapter: LanguageSettingsAdapter,
  scopeKey: string,
  epoch: number
): SettingsViewState => {
  const acknowledged = view.acknowledged;

  const confirmed =
    acknowledged !== null &&
    acknowledged.adapter === adapter &&
    equal(acknowledged.settings, snapshot.record.settings) &&
    equal(view.draft, acknowledged.settings);

  const adopt = !settingsDraftDirty(view) || confirmed;

  return {
    ...view,
    snapshot,
    adapter,
    scopeKey,
    epoch,
    valid: true,
    acknowledged: null,
    baseline: adopt ? snapshot.record : view.baseline,
    draft: adopt ? snapshot.record.settings : view.draft,
    editingEpoch: adopt ? view.editingEpoch + 1 : view.editingEpoch,
  };
};

export const discardSettingsDraft = (view: SettingsViewState): SettingsViewState =>
  view.snapshot === null
    ? view
    : {
        ...view,
        baseline: view.snapshot.record,
        draft: view.snapshot.record.settings,
        acknowledged: null,
        editingEpoch: view.editingEpoch + 1,
      };
