/**
 * The tab completion status card's view model (DESIGN.md, Tab completion status card): a
 * headline and why, where completion runs, how fast, what context it gets, which models it
 * can use, and the actions this state allows.
 */
import { hostCanServe, promptableModel, scorePlacement } from "@polaris/client/prediction/score";
import type {
  ConnectionState,
  PredictionEndpoint,
  PredictionServerAction,
  PredictionServerReport,
} from "@polaris/protocol";
import { Match } from "effect";
import type { PredictionInspection } from "../../../../../shared/predictionContract.ts";
import type { PredictionPreferences } from "../../../../../shared/predictionPlacement.ts";
import { inSentence, placementRow } from "../../../settings/editor/placementRows.ts";
import type { Fact } from "../../status/model.ts";
import { modelName, type CompletionStatus } from "../store.ts";
import { contextFact, latencyFact, placementNote, SERVER_NAMES } from "./facts.ts";

export type CardKind =
  | "offline"
  | "reconnecting"
  | "offer"
  | "off"
  | "off-host"
  | "finding"
  | "no-server"
  | "failed"
  | "ready"
  | "serving";

export interface CardInput {
  readonly connection: ConnectionState | undefined;
  /** The Host's name in a sentence ("this Mac", "Mac Studio"). */
  readonly hostName: string;
  readonly hostKey: string;
  readonly enabled: boolean;
  readonly offer: boolean;
  readonly preferences: PredictionPreferences;
  readonly inspection: PredictionInspection | undefined;
  readonly result: CompletionStatus | undefined;
  /** The last completion's failure; empty or undefined when none. */
  readonly failure: string | undefined;
  /** Whether the open file's Workspace is trusted; null while unknown. */
  readonly trusted: boolean | null;
  /** The model server behind the target, once asked. */
  readonly server: PredictionServerReport | null;
  /** The model servers' memory on this machine (Settings' line); null while unknown. */
  readonly memory: string | null;
}

/** Where completion runs, or would run on the next keystroke. */
export interface CardTarget {
  readonly side: "client" | "host";
  readonly endpoint: PredictionEndpoint;
  readonly model: string;
  /** The serving machine in a sentence. */
  readonly machine: string;
  /** True when the last completion came from here. */
  readonly served: boolean;
}

export interface ModelChoice {
  /** Null is Recommended. */
  readonly id: string | null;
  readonly label: string;
  readonly note: string | null;
  readonly enabled: boolean;
}

export type CardActionId =
  | "turn-on"
  | "turn-on-host"
  | "turn-off-host"
  | "check-again"
  | PredictionServerAction
  | "settings";

export interface CardAction {
  readonly id: CardActionId;
  readonly label: string;
}

export interface CompletionCardView {
  readonly kind: CardKind;
  /** The status bar's short label. */
  readonly label: string;
  readonly title: string;
  readonly why: string;
  /** The model server's own words for the last failure. */
  readonly failure: string | null;
  readonly facts: ReadonlyArray<Fact>;
  readonly memory: string | null;
  /** Null unless there's more than one model to choose from. */
  readonly models: ReadonlyArray<ModelChoice> | null;
  readonly selectedModel: string | null;
  readonly target: CardTarget | null;
  /** What the user can do when the server offers no recovery of its own. */
  readonly advice: string | null;
  readonly actions: ReadonlyArray<CardAction>;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const clientNameOf = (input: CardInput) => inSentence(input.inspection?.clientLabel ?? "This Mac");

const scored = (input: CardInput) =>
  input.inspection === undefined
    ? []
    : scorePlacement({
        client: input.inspection.client,
        host: input.inspection.host,
        override: input.preferences.placement,
        model: input.preferences.model,
        format: input.preferences.format,
      });

/** The last completion's side while placement could still pick it, else placement's first. */
export const cardTarget = (input: CardInput): CardTarget | null => {
  const targets = scored(input);
  const { result } = input;

  const machineOf = (side: CardTarget["side"]) =>
    side === "client" ? clientNameOf(input) : input.hostName;

  if (result?.side !== undefined && result.endpoint !== undefined) {
    const same = targets.find((t) => t.side === result.side && t.model === result.model);

    if (same !== undefined)
      return {
        side: result.side,
        endpoint: result.endpoint,
        model: result.model,
        machine: machineOf(result.side),
        served: true,
      };
  }

  const first = targets[0];

  if (first === undefined) return null;

  return {
    side: first.side,
    endpoint: { kind: first.endpoint.kind, url: first.endpoint.url },
    model: first.model,
    machine: machineOf(first.side),
    served: false,
  };
};

const connectionKind = (connection: ConnectionState | undefined): CardKind | null =>
  Match.value(connection).pipe(
    Match.when("connected", () => null),
    Match.when("reconnecting", () => "reconnecting" as const),
    Match.orElse(() => "offline" as const)
  );

const settingsKind = (input: CardInput): CardKind | null => {
  if (input.offer) return "offer";

  if (!input.enabled) return "off";

  if (input.preferences.placement === "off") return "off-host";

  return input.inspection === undefined ? "finding" : null;
};

export const cardKind = (input: CardInput, target: CardTarget | null): CardKind => {
  const early = connectionKind(input.connection) ?? settingsKind(input);

  if (early !== null) return early;

  if (target === null) return "no-server";

  if (input.failure) return "failed";

  return target.served ? "serving" : "ready";
};

const LABELS: Record<CardKind, string> = {
  offline: "Completions unavailable",
  reconnecting: "Completions unavailable",
  offer: "Model server found · Turn on tab completion",
  off: "Completions off",
  "off-host": "Completions off",
  finding: "Completions",
  "no-server": "Completions unavailable",
  failed: "Completions unavailable",
  ready: "Completions",
  serving: "Completions",
};

const machinesChecked = (input: CardInput, joiner: "and" | "or") => {
  const client = clientNameOf(input);
  const host = input.inspection?.host;
  // A Raspberry Pi-class host never serves, so it isn't worth suggesting.
  const small = host !== null && host !== undefined && !hostCanServe(host.machine);

  return client === input.hostName || (joiner === "or" && small)
    ? client
    : `${client} ${joiner} ${input.hostName}`;
};

/** The model a discovered server offers, and where: the Client's first, as turning it on does. */
const offered = (input: CardInput) => {
  const inspection = input.inspection;
  const client = inspection?.client.endpoints.find((e) => e.models.length > 0);
  const host = inspection?.host?.endpoints.find((e) => e.models.length > 0);
  const endpoint = client ?? host;

  return {
    model: modelName(endpoint?.models[0] ?? "a model"),
    machine: client === undefined ? input.hostName : clientNameOf(input),
  };
};

const unserved = (input: CardInput) => {
  const row = placementRow({
    host: { key: input.hostKey, label: input.hostName, state: "connected" },
    preferences: input.preferences,
    inspection: input.inspection,
    result: undefined,
    clientName: clientNameOf(input),
  });

  return row.models.length === 0
    ? {
        title: "No model server found",
        why: `Run llama-server, LM Studio or Ollama on ${machinesChecked(input, "or")}, then check again.`,
      }
    : { title: "No model it can use", why: `${row.caption}.` };
};

const headline = (
  kind: CardKind,
  input: CardInput,
  target: CardTarget | null
): { readonly title: string; readonly why: string } => {
  const host = input.hostName;
  const served = target === null ? "" : `${modelName(target.model)} on ${target.machine}`;
  const away = "Completion needs context from the host, so it waits until the host is back.";

  return Match.value(kind).pipe(
    Match.when("offline", () => ({ title: `${capitalized(host)} is offline`, why: away })),
    Match.when("reconnecting", () => ({ title: `Reconnecting to ${host}`, why: away })),
    Match.when("offer", () => {
      const found = offered(input);

      return {
        title: "Model server found",
        why: `${found.model} is running on ${found.machine}. Tab completion stays off until you turn it on.`,
      };
    }),
    Match.when("off", () => ({
      title: "Tab completion is off",
      why: "It's off for every host. Nothing is sent to a model server.",
    })),
    Match.when("off-host", () => ({
      title: `Off for ${host}`,
      why: "It's set to Off for this host; other hosts keep their own setting.",
    })),
    Match.when("finding", () => ({
      title: "Finding a model server…",
      why: `Checking ${machinesChecked(input, "and")} for llama-server, LM Studio or Ollama.`,
    })),
    Match.when("no-server", () => unserved(input)),
    Match.when("failed", () => ({
      title: "The last completion failed",
      why: `${served} didn't answer with a completion.`,
    })),
    Match.when("ready", () => ({
      title: "Tab completion is ready",
      why: `${served} completes from your next keystroke.`,
    })),
    Match.orElse(() => ({ title: "Tab completion is on", why: `Completing with ${served}.` }))
  );
};

const serverName = (input: CardInput, target: CardTarget) =>
  input.server === null || input.server.kind === "unknown"
    ? target.endpoint.kind === "ollama"
      ? "Ollama"
      : "OpenAI-compatible"
    : SERVER_NAMES[input.server.kind];

const facts = (input: CardInput, target: CardTarget | null): ReadonlyArray<Fact> => {
  if (target === null) return [];
  const where = new URL(target.endpoint.url).host;

  return [
    {
      label: "Model",
      value: modelName(target.model),
      note: input.preferences.model === null ? "recommended" : "chosen",
    },
    {
      label: "Runs on",
      value: capitalized(target.machine),
      note: placementNote(input, target),
    },
    { label: "Endpoint", value: where, mono: true, note: serverName(input, target) },
    ...latencyFact(input.result, target),
    ...contextFact(input.result, target, input.trusted),
  ];
};

/** Recommended first, then every model the allowed sides offer; unpromptable ones say why. */
const modelChoices = (input: CardInput): ReadonlyArray<ModelChoice> | null => {
  const row = placementRow({
    host: { key: input.hostKey, label: input.hostName, state: "connected" },
    preferences: input.preferences,
    inspection: input.inspection,
    result: undefined,
    clientName: clientNameOf(input),
  });

  if (row.models.length < 2) return null;
  const recommended = scored({ ...input, preferences: { ...input.preferences, model: null } })[0];
  const { model: chosen, format } = input.preferences;

  return [
    {
      id: null,
      label: "Recommended",
      note: recommended === undefined ? null : modelName(recommended.model),
      enabled: true,
    },
    ...row.models.map((model) => {
      const enabled = promptableModel(model) || (model === chosen && format !== null);

      return {
        id: model,
        label: model,
        note: enabled ? null : "can't prompt yet",
        enabled,
      };
    }),
  ];
};

const SERVER_LABEL: Record<PredictionServerAction, (model: string) => string> = {
  "clear-cache": () => "Clear prompt cache",
  "reload-model": (model) => `Reload ${modelName(model)}`,
};

const working = (kind: CardKind) => kind === "serving" || kind === "ready" || kind === "failed";

const actionsOf = (
  kind: CardKind,
  input: CardInput,
  target: CardTarget | null
): ReadonlyArray<CardAction> => {
  const settings: CardAction = { id: "settings", label: "Tab completion settings" };
  const check: CardAction = { id: "check-again", label: "Check again" };

  if (kind === "offer" || kind === "off")
    return [{ id: "turn-on", label: "Turn on tab completion" }, settings];

  if (kind === "off-host")
    return [{ id: "turn-on-host", label: `Turn on for ${input.hostName}` }, settings];

  if (kind === "no-server") return [check, settings];

  if (!working(kind) || target === null) return [settings];

  return [
    check,
    ...(input.server?.actions ?? []).map((id) => ({ id, label: SERVER_LABEL[id](target.model) })),
    { id: "turn-off-host", label: `Turn off for ${input.hostName}` },
    settings,
  ];
};

const adviceOf = (kind: CardKind, input: CardInput, target: CardTarget | null) => {
  if (!working(kind) || target === null || input.server === null) return null;

  if (input.server.actions.length > 0) return null;

  const name =
    input.server.kind === "unknown" ? "the model server" : SERVER_NAMES[input.server.kind];

  return `If it stops answering, restart ${name} on ${target.machine}.`;
};

export const completionCard = (input: CardInput): CompletionCardView => {
  const target = cardTarget(input);
  const kind = cardKind(input, target);
  const { title, why } = headline(kind, input, target);
  const shows = working(kind);

  return {
    kind,
    label: LABELS[kind],
    title,
    why,
    // "Error: " and "PredictionError: " are the IPC's framing, not the server's words.
    failure: kind === "failed" ? (input.failure?.replace(/^\w*Error:\s*/, "") ?? null) : null,
    facts: shows ? facts(input, target) : [],
    memory: shows && target?.side === "client" ? input.memory : null,
    models: shows || kind === "no-server" ? modelChoices(input) : null,
    selectedModel: input.preferences.model,
    target: shows ? target : null,
    advice: adviceOf(kind, input, target),
    actions: actionsOf(kind, input, target),
  };
};
