/**
 * The model sheet's decisions, as the Desktop App's session composer makes them
 * (`harness/model/models.ts`): how a Model pick takes effect, the effort it runs with, and the
 * permission modes the Host offers.
 */
import {
  type Capability,
  Command,
  type HarnessKind,
  type Model,
  type ModelId,
  type PermissionMode,
  type ReasoningEffort,
  type SessionId,
  type TurnId,
} from "@polaris/protocol";
import { PERMISSION_MODES, type PermissionOption } from "../newSession/model.ts";

export type ModelChange =
  | { readonly kind: "set" }
  | { readonly kind: "fork" }
  | { readonly kind: "blocked"; readonly reason: string };

export interface ChangeContext {
  /** The Harness can switch Model mid-session (`HarnessModels.switchesModel`). */
  readonly switchesModel: boolean;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly turnInFlight: boolean;
  readonly hasFinishedTurn: boolean;
}

/** `SetModel` between Turns; a Fork where the Harness can't switch; else why not. */
export const modelChange = (ctx: ChangeContext): ModelChange => {
  if (ctx.switchesModel && ctx.capabilities.includes("session.set-model"))
    return ctx.turnInFlight
      ? { kind: "blocked", reason: "Switch model once this turn ends" }
      : { kind: "set" };

  if (ctx.capabilities.includes("session.fork") && ctx.hasFinishedTurn) return { kind: "fork" };

  return { kind: "blocked", reason: "This harness can't switch model in a session yet" };
};

export const CHANGE_NOTES: Readonly<Record<ModelChange["kind"], string | null>> = {
  set: "Applies from the next turn",
  fork: "This harness can't switch model in a session; picking one forks a new session",
  blocked: null,
};

/** What Polaris sends when a Harness doesn't say a Model's default effort. */
const FALLBACK_EFFORT = "medium";

/** The effort a Model runs with when none is picked: its default, else medium, else its first. */
export const defaultEffort = (model: Model): ReasoningEffort | null => {
  if (model.defaultEffort !== null) return model.defaultEffort;

  if (model.efforts.includes(FALLBACK_EFFORT)) return FALLBACK_EFFORT;

  return model.efforts[0] ?? null;
};

/** The chosen effort if the Model takes it, else its default. */
export const effortFor = (model: Model, chosen: ReasoningEffort | null): ReasoningEffort | null =>
  chosen !== null && model.efforts.includes(chosen) ? chosen : defaultEffort(model);

/** The session's Model in the list: its own, else the Harness's default. */
export const currentModel = (models: ReadonlyArray<Model>, id: ModelId | null): Model | null =>
  models.find((m) => m.id === id) ?? models.find((m) => m.isDefault) ?? null;

/** The modes the Host offers: Plan needs `session.plan-mode`. */
export const permissionModesFor = (
  capabilities: ReadonlyArray<Capability>
): ReadonlyArray<PermissionOption> =>
  capabilities.includes("session.plan-mode")
    ? PERMISSION_MODES
    : PERMISSION_MODES.filter((p) => p.mode !== "plan");

export const setPermissionCommand = (sessionId: SessionId, permissionMode: PermissionMode) =>
  Command.cases.SetPermissionMode.make({ sessionId, permissionMode });

export const setModelCommand = (
  sessionId: SessionId,
  model: Model,
  chosen: ReasoningEffort | null
): Command =>
  Command.cases.SetModel.make({ sessionId, model: model.id, effort: effortFor(model, chosen) });

/** A Fork from the last finished Turn, on another Harness or another Model of this one. */
export const forkCommand = (fork: {
  readonly sessionId: SessionId;
  readonly fromSessionId: SessionId;
  readonly fromTurnId: TurnId;
  readonly harness: HarnessKind;
  readonly model: Model | null;
  readonly effort: ReasoningEffort | null;
}): Command =>
  Command.cases.ForkSession.make({
    sessionId: fork.sessionId,
    fromSessionId: fork.fromSessionId,
    fromTurnId: fork.fromTurnId,
    harness: fork.harness,
    model: fork.model?.id ?? null,
    effort: fork.model === null ? null : effortFor(fork.model, fork.effort),
  });
