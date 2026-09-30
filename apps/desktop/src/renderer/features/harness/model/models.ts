/**
 * The Model and effort picker over `harness.models`. Claude Code lists a
 * `default` row meaning "whatever Claude Code picks"; the picker hides it and
 * shows a session whose Model is null as "Default" instead. A Model that takes
 * effort is always sent a concrete one.
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

/** What Polaris sends when a Harness doesn't say a Model's default effort. */
export const FALLBACK_EFFORT = "medium";

/** The rows the picker offers for a Harness. */
export const pickableModels = (
  harness: string,
  models: ReadonlyArray<ModelData>
): ReadonlyArray<ModelData> =>
  harness === "claude" ? models.filter((m) => m.id !== CLAUDE_DEFAULT_ROW) : models;

/** The effort a Model runs with when none is picked: its default, else medium, else its first. */
export const defaultEffort = (model: ModelData): string | null => {
  if (model.defaultEffort !== null) return model.defaultEffort;

  if (model.efforts.includes(FALLBACK_EFFORT)) return FALLBACK_EFFORT;

  return model.efforts[0] ?? null;
};

/** The effort to send with a Model: the chosen one if it supports it, else its default. */
export const effortFor = (model: ModelData, chosen: string | null): string | null => {
  if (chosen !== null && model.efforts.includes(chosen)) return chosen;

  return defaultEffort(model);
};

/** Said beside the efforts when the Harness gave no default and Polaris picked one. */
export const effortNote = (harnessName: string, model: ModelData): string | null => {
  const picked = defaultEffort(model);

  if (model.defaultEffort !== null || picked === null) return null;

  return `${harnessName} doesn't say ${model.name}'s default effort; Polaris sends ${picked}.`;
};

export const choose = (model: ModelData, chosen: string | null = null): ModelChoice => ({
  model: model.id,
  effort: effortFor(model, chosen),
});

const nameOf = (models: ReadonlyArray<ModelData>, model: string | null) => {
  if (model === null || model === CLAUDE_DEFAULT_ROW) return "Default";

  return models.find((m) => m.id === model)?.name ?? model;
};

/** The label for a Model and effort, as the Harness names them ("Opus 5 · high"). */
export const modelLabel = (
  models: ReadonlyArray<ModelData>,
  model: string | null,
  effort: string | null
): string => {
  const name = nameOf(models, model);

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

export type ModelChange =
  /** `SetModel` for the next Turns. */
  | { readonly kind: "set" }
  /** The Harness can't switch mid-session: a Fork on the new Model. */
  | { readonly kind: "fork" }
  /** Nothing can change now; `reason` says why. */
  | { readonly kind: "blocked"; readonly reason: string };

export interface ChangeContext {
  /** The Harness reports it can switch Model mid-session (`switchesModel`). */
  readonly switchesModel: boolean;
  /** The Daemon has `session.set-model`. */
  readonly canSetModel: boolean;
  readonly canFork: boolean;
  /** A Turn is in flight: `SetModel` waits until it ends. */
  readonly turnInFlight: boolean;
  /** A finished Turn exists to fork from. */
  readonly hasFinishedTurn: boolean;
}

/** How picking another Model in a session takes effect. */
export const modelChange = (ctx: ChangeContext): ModelChange => {
  if (ctx.switchesModel && ctx.canSetModel) {
    return ctx.turnInFlight
      ? { kind: "blocked", reason: "Switch Model once this turn ends" }
      : { kind: "set" };
  }

  if (ctx.canFork && ctx.hasFinishedTurn) return { kind: "fork" };

  return { kind: "blocked", reason: "This harness can't switch model in a session yet" };
};
