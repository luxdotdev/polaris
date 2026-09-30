/**
 * The Model and effort picker over `harness.models`. Claude Code lists a
 * `default` row meaning "whatever Claude Code picks"; the picker hides it and
 * shows a session whose Model is null as "Default" instead.
 */
import type { Model } from "@polaris/protocol";
import type { Plain } from "../../../../shared/api.ts";

export type ModelData = Plain<Model>;

export interface ModelChoice {
  readonly model: string;
  /** Always concrete when the Model takes effort: the pick, else its default. */
  readonly effort: string | null;
}

const CLAUDE_DEFAULT_ROW = "default";

/** The rows the picker offers for a Harness. */
export const pickableModels = (
  harness: string,
  models: ReadonlyArray<ModelData>
): ReadonlyArray<ModelData> =>
  harness === "claude" ? models.filter((m) => m.id !== CLAUDE_DEFAULT_ROW) : models;

/** The effort to send with a Model: the chosen one if it supports it, else the Model's default. */
export const effortFor = (model: ModelData, chosen: string | null): string | null => {
  if (chosen !== null && model.efforts.includes(chosen)) return chosen;

  return model.defaultEffort;
};

export const choose = (model: ModelData, chosen: string | null = null): ModelChoice => ({
  model: model.id,
  effort: effortFor(model, chosen),
});

/** The label for the session's Model and effort, as the Harness names them. */
export const modelLabel = (
  models: ReadonlyArray<ModelData>,
  model: string | null,
  effort: string | null
): string => {
  const found = model === null ? undefined : models.find((m) => m.id === model);
  const name = model === null || model === CLAUDE_DEFAULT_ROW ? "Default" : (found?.name ?? model);

  return effort === null ? name : `${name} · ${effort}`;
};

/** The Model a new session starts on when the user doesn't pick: the Harness's default row. */
export const defaultChoice = (
  harness: string,
  models: ReadonlyArray<ModelData>
): ModelChoice | null => {
  if (harness === "claude") return null;
  const model = models.find((m) => m.isDefault) ?? models[0];

  return model === undefined ? null : choose(model);
};
