/**
 * The tab completion status card's view model (DESIGN.md, Tab completion status card): a
 * headline and why, where completion runs, how fast, what context it gets, which models it
 * can use, and the actions this state allows.
 */
import { editModelFormat } from "@polaris/client/prediction";
import { hostCanServe, promptableModel, scorePlacement } from "@polaris/client/prediction/score";
import type {
  ConnectionState,
  PredictionEndpoint,
  PredictionServerAction,
  PredictionServerReport,
} from "@polaris/protocol";
import { Match } from "effect";
import type { PredictionInspection } from "../../../../../shared/predictionContract.ts";
import type { PredictionMetrics } from "../../../../../shared/predictionOutcomes.ts";
import type { PredictionPreferences } from "../../../../../shared/predictionPlacement.ts";
import { inSentence, placementRow } from "../../../settings/editor/placementRows.ts";
import type { Fact } from "../../status/model.ts";
import { modelName, type CompletionStatus } from "../store.ts";
import { contextFact, latencyFact, metricsFacts, placementNote, SERVER_NAMES } from "./facts.ts";
import { clientCopy } from "../../../../../shared/clientCopy.ts";
import {
  loadFact,
  managedBusy,
  managedHeadline,
  managedLog,
  managedOf,
  managedProgress,
  type ManagedView,
} from "./managed.ts";

export type CardKind =
  | "offline"
  | "reconnecting"
  | "offer"
  | "off"
  | "off-host"
  | "finding"
  | "setup"
  | "downloading"
  | "loading"
  | "setup-failed"
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
  /** The outcome log's counts (spec §7), read when the card opens; null until then. */
  readonly metrics: PredictionMetrics | null;
}

/** The llama-server flags a next-edit model wants (spec §7): prompt reuse and n-gram speculation. */
export const LLAMA_SERVER_COMMAND =
  "llama-server --model /path/to/next-edit.gguf --port 8080 --spec-type ngram-simple --spec-ngram-simple-size-n 8 --spec-ngram-simple-size-m 48 --cache-reuse 256";

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
  | "set-up"
  | "cancel-download"
  | "retry-setup"
  | "remove-model"
  | "copy-command"
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
  /** What next edits need, when the user's own server completes at the cursor only (EP8b). */
  readonly caption: string | null;
  /** What the user can do when the server offers no recovery of its own. */
  readonly advice: string | null;
  readonly actions: ReadonlyArray<CardAction>;
  /** The managed server the setup states describe, with its side. */
  readonly managed: ManagedView | null;
  /** The download's share, 0..1, while one runs. */
  readonly progress: number | null;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const nextEdit = (model: string) => editModelFormat(model) !== null;

/** What the model does, as the card's Model fact reads it first (DESIGN.md, EP8). */
const kindOf = (model: string) => (nextEdit(model) ? "Next edit" : "Insertion only");

/** A model server of the user's own that completes at the cursor only (EP8b). */
const insertionOnly = (target: CardTarget | null, managed: ManagedView | null) =>
  target !== null && !nextEdit(target.model) && !ownsTarget(managed, target);

const clientNameOf = (input: CardInput) =>
  inSentence(input.inspection?.clientLabel ?? clientCopy().localHost);

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

const managedKind = (view: ManagedView | null, target: CardTarget | null): CardKind | null => {
  if (view === null) return null;
  const own = target !== null && target.endpoint.url === view.status.endpoint?.url;

  return Match.value(view.status.phase).pipe(
    Match.tag("Absent", () => (target === null ? ("setup" as const) : null)),
    Match.tags({
      Downloading: () => "downloading" as const,
      Verifying: () => "downloading" as const,
    }),
    Match.tags({
      Starting: () => (own ? ("loading" as const) : null),
      Backoff: () => (own ? ("loading" as const) : null),
    }),
    Match.tag("Failed", () => (target === null || own ? ("setup-failed" as const) : null)),
    Match.orElse(() => null)
  );
};

export const cardKind = (
  input: CardInput,
  target: CardTarget | null,
  managed: ManagedView | null = managedOf(input.inspection?.managed, input.preferences.placement)
): CardKind => {
  const early =
    connectionKind(input.connection) ?? settingsKind(input) ?? managedKind(managed, target);

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
  setup: "Set up tab completion",
  downloading: "Downloading model",
  loading: "Loading model",
  "setup-failed": "Completions unavailable",
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

const machineOf = (input: CardInput, side: ManagedView["side"]) =>
  side === "client" ? clientNameOf(input) : input.hostName;

const headline = (
  kind: CardKind,
  input: CardInput,
  target: CardTarget | null,
  managed: ManagedView | null
): { readonly title: string; readonly why: string } => {
  const host = input.hostName;
  const served = target === null ? "" : `${modelName(target.model)} on ${target.machine}`;
  const away = "Completion needs context from the host, so it waits until the host is back.";
  const setup = managed === null ? null : managedHeadline(managed, machineOf(input, managed.side));

  if (
    setup !== null &&
    (kind === "setup" || kind === "downloading" || kind === "loading" || kind === "setup-failed")
  )
    return setup;

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
    Match.orElse(() => ({
      title: "Tab completion is on",
      why:
        target !== null && nextEdit(target.model)
          ? `${served} suggests edits near the cursor and in the rest of this file.`
          : `${served} completes at the cursor. It can't suggest edits elsewhere.`,
    }))
  );
};

const ownsTarget = (managed: ManagedView | null, target: CardTarget) =>
  managed !== null && managed.status.endpoint?.url === target.endpoint.url;

const serverName = (input: CardInput, target: CardTarget, managed: ManagedView | null) =>
  ownsTarget(managed, target)
    ? "Polaris"
    : input.server === null || input.server.kind === "unknown"
      ? target.endpoint.kind === "ollama"
        ? "Ollama"
        : "OpenAI-compatible"
      : SERVER_NAMES[input.server.kind];

const facts = (
  input: CardInput,
  target: CardTarget | null,
  managed: ManagedView | null
): ReadonlyArray<Fact> => {
  if (target === null) return [];
  const where = new URL(target.endpoint.url).host;

  return [
    {
      label: "Model",
      value: `${kindOf(target.model)} · ${modelName(target.model)}`,
      note: input.preferences.model === null ? "recommended" : "chosen",
    },
    {
      label: "Runs on",
      value: capitalized(target.machine),
      note: placementNote(input, target),
    },
    { label: "Endpoint", value: where, mono: true, note: serverName(input, target, managed) },
    ...latencyFact(input.result, target),
    ...loadFact(target, managed),
    ...contextFact(input.result, target, input.trusted),
    ...metricsFacts(input.metrics),
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
        label: modelName(model),
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

const setupActions = (
  kind: CardKind,
  managed: ManagedView | null,
  settings: CardAction
): ReadonlyArray<CardAction> | null => {
  if (managed === null) return null;
  const name = managed.status.model.name;

  return Match.value(kind).pipe(
    Match.when("setup", () => [{ id: "set-up" as const, label: `Download ${name}` }, settings]),
    Match.when("downloading", () => [
      { id: "cancel-download" as const, label: "Cancel download" },
      settings,
    ]),
    Match.when("loading", () => [settings]),
    Match.when("setup-failed", () => [
      { id: "retry-setup" as const, label: "Try again" },
      { id: "remove-model" as const, label: "Remove downloaded model" },
      settings,
    ]),
    Match.orElse(() => null)
  );
};

const actionsOf = (
  kind: CardKind,
  input: CardInput,
  target: CardTarget | null,
  managed: ManagedView | null
): ReadonlyArray<CardAction> => {
  const settings: CardAction = { id: "settings", label: "Tab completion settings" };
  const check: CardAction = { id: "check-again", label: "Check again" };
  const setup = setupActions(kind, managed, settings);

  if (setup !== null) return setup;

  if (kind === "offer" || kind === "off")
    return [{ id: "turn-on", label: "Turn on tab completion" }, settings];

  if (kind === "off-host")
    return [{ id: "turn-on-host", label: `Turn on for ${input.hostName}` }, settings];

  if (kind === "no-server") return [check, settings];

  if (!working(kind) || target === null) return [settings];

  return [
    ...(insertionOnly(target, managed)
      ? [{ id: "copy-command" as const, label: "Copy llama-server command" }]
      : []),
    check,
    ...(input.server?.actions ?? []).map((id) => ({ id, label: SERVER_LABEL[id](target.model) })),
    { id: "turn-off-host", label: `Turn off for ${input.hostName}` },
    settings,
  ];
};

const captionOf = (kind: CardKind, target: CardTarget | null, managed: ManagedView | null) =>
  working(kind) && insertionOnly(target, managed)
    ? "Next edits need Zeta 2.1 or Sweep Next-Edit."
    : null;

const adviceOf = (kind: CardKind, input: CardInput, target: CardTarget | null) => {
  if (!working(kind) || target === null || input.server === null) return null;

  if (input.server.actions.length > 0) return null;

  const name =
    input.server.kind === "unknown" ? "the model server" : SERVER_NAMES[input.server.kind];

  return `If it stops answering, restart ${name} on ${target.machine}.`;
};

const progressLabel = (kind: CardKind, progress: number | null, managed: ManagedView | null) => {
  if (kind === "downloading" && progress !== null)
    return `${LABELS[kind]} · ${Math.floor(progress * 100)}%`;

  if (kind === "loading" && managed !== null) return `Loading ${managed.status.model.name}…`;

  return LABELS[kind];
};

export const completionCard = (input: CardInput): CompletionCardView => {
  const target = cardTarget(input);
  const managed = managedOf(input.inspection?.managed, input.preferences.placement);
  const kind = cardKind(input, target, managed);
  const { title, why } = headline(kind, input, target, managed);
  const shows = working(kind);
  const progress = managedBusy(managed) ? managedProgress(managed) : null;

  return {
    kind,
    label: progressLabel(kind, progress, managed),
    title,
    why,
    // "Error: " and "PredictionError: " are the IPC's framing, not the server's words.
    failure: Match.value(kind).pipe(
      Match.when("failed", () => input.failure?.replace(/^\w*Error:\s*/, "") ?? null),
      Match.when("setup-failed", () => managedLog(managed)),
      Match.orElse(() => null)
    ),
    facts: shows ? facts(input, target, managed) : [],
    memory: shows && target?.side === "client" ? input.memory : null,
    models: shows || kind === "no-server" ? modelChoices(input) : null,
    selectedModel: input.preferences.model,
    target: shows ? target : null,
    caption: captionOf(kind, target, managed),
    advice: adviceOf(kind, input, target),
    actions: actionsOf(kind, input, target, managed),
    managed,
    progress: kind === "downloading" ? progress : null,
  };
};
