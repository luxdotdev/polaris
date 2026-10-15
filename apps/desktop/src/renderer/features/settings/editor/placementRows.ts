/**
 * Settings → Editor → Completion placement as rows: one per Host, saying which machine serves
 * its completion and which models that machine can choose from.
 */
import { hostCanServe, scorePlacement } from "@polaris/client/prediction/score";
import type { ConnectionState } from "@polaris/protocol";
import type { PredictionInspection } from "../../../../shared/predictionContract.ts";
import type { PredictionPreferences } from "../../../../shared/predictionPlacement.ts";
import { modelName } from "../../editor/prediction/store.ts";
import { inSentence as localInSentence } from "../../../../shared/clientCopy.ts";

export interface PlacementHost {
  readonly key: string;
  readonly label: string;
  readonly state: ConnectionState;
}

export interface ServedResult {
  readonly model: string;
  readonly machine: string;
}

export interface PlacementRowInput {
  readonly host: PlacementHost;
  readonly preferences: PredictionPreferences;
  readonly inspection: PredictionInspection | undefined;
  readonly result: ServedResult | undefined;
  /** The Client machine's name as a label ("This Mac", "Mac Studio"). */
  readonly clientName: string;
}

export interface PlacementRow {
  readonly key: string;
  readonly name: string;
  readonly caption: string;
  readonly placement: PredictionPreferences["placement"];
  /** False only once the Host reported a machine too small to serve. */
  readonly hostCanServe: boolean;
  /** The chosen model, or null for the recommended one. */
  readonly model: string | null;
  readonly models: ReadonlyArray<string>;
  /** The chosen model is on no machine that can serve this Host. */
  readonly modelMissing: boolean;
}

/** A machine's label inside a sentence: the default "This Mac" becomes "this Mac". */
export const inSentence = (label: string) => localInSentence(label);

const AWAY: Readonly<Record<Exclude<ConnectionState, "connected">, string>> = {
  reconnecting: "Reconnecting",
  "needs-attention": "Needs attention",
  offline: "Offline",
};

const TOO_SMALL = "this host is too small to serve";

const sidesFor = (placement: PredictionPreferences["placement"], canServe: boolean) => ({
  client: placement === "auto" || placement === "client",
  host: canServe && (placement === "auto" || placement === "host"),
});

const modelsOn = (input: PlacementRowInput, canServe: boolean) => {
  const sides = sidesFor(input.preferences.placement, canServe);

  const endpoints = [
    ...(sides.client ? (input.inspection?.client.endpoints ?? []) : []),
    ...(sides.host ? (input.inspection?.host?.endpoints ?? []) : []),
  ];

  return [...new Set(endpoints.flatMap((endpoint) => endpoint.models))];
};

/** Where completion runs: the last completion's machine, else the one placement would pick. */
const servedBy = (input: PlacementRowInput, hostName: string) => {
  const { inspection, preferences, result } = input;

  if (inspection === undefined) return null;

  const targets = scorePlacement({
    client: inspection.client,
    host: inspection.host,
    override: preferences.placement,
    model: preferences.model,
    format: preferences.format,
  });

  const sideOf = (machine: string) =>
    machine === inspection.clientLabel
      ? "client"
      : machine === inspection.hostLabel
        ? "host"
        : null;

  const fromResult =
    result === undefined ? undefined : targets.find((t) => t.side === sideOf(result.machine));

  const target = fromResult ?? targets[0];

  if (target === undefined) return null;

  return {
    machine: target.side === "client" ? inSentence(input.clientName) : hostName,
    model: modelName(fromResult === undefined ? target.model : (result?.model ?? target.model)),
  };
};

/** What placement can prompt today (spec §2): next-edit models first, v1's FIM pair at the cursor. */
const PROMPTABLE =
  "Sweep Next-Edit or Zeta 2.1 suggest edits; Mellum2 and Qwen2.5-Coder complete at the cursor";

const unserved = (input: PlacementRowInput, canServe: boolean, models: ReadonlyArray<string>) => {
  if (input.preferences.placement === "host" && !canServe)
    return "This host is too small to serve · choose Auto or This machine";

  const small = canServe ? "" : ` · ${TOO_SMALL}`;

  if (models.length === 0) return `No model server found${small}`;

  const chosen = input.preferences.model;

  if (chosen !== null && !models.includes(chosen))
    return `${chosen} isn't on a model server it can use${small}`;

  // Without a known prompt format, placement takes only the models it has a prompt for.
  if (chosen !== null && input.preferences.format === null)
    return `Polaris can't prompt ${chosen} yet · ${PROMPTABLE}${small}`;

  return `No model Polaris can prompt · ${PROMPTABLE}${small}`;
};

const captionOf = (input: PlacementRowInput, canServe: boolean, models: ReadonlyArray<string>) => {
  if (input.host.state !== "connected") return AWAY[input.host.state];

  if (input.preferences.placement === "off") return "Off for this host";

  if (input.inspection === undefined) return "Finding model server…";

  const served = servedBy(input, inSentence(input.host.label));

  if (served === null) return unserved(input, canServe, models);

  return [`Served by ${served.machine}`, served.model, canServe ? null : TOO_SMALL]
    .filter((part) => part !== null)
    .join(" · ");
};

export const placementRow = (input: PlacementRowInput): PlacementRow => {
  const machine = input.inspection?.host?.machine;
  const canServe = machine === undefined ? true : hostCanServe(machine);
  const models = modelsOn(input, canServe);
  const model = input.preferences.model;

  return {
    key: input.host.key,
    name: input.host.label,
    caption: captionOf(input, canServe, models),
    placement: input.preferences.placement,
    hostCanServe: canServe,
    model,
    models,
    modelMissing: model !== null && !models.includes(model),
  };
};

const GiB = 1024 ** 3;

const MiB = 1024 ** 2;

const SERVER_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^llama-server/i, "llama-server"],
  [/^ollama/i, "Ollama"],
  [/^(?:llmster|LM)/i, "LM Studio"],
];

const sizeOf = (bytes: number) =>
  bytes >= GiB ? `${(bytes / GiB).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / MiB))} MB`;

/** Under 128 MB a server is resident without a model loaded, which is what the user asks. */
const serverPart = (server: { readonly name: string; readonly rssBytes: number }) => {
  const label = SERVER_LABELS.find(([pattern]) => pattern.test(server.name))?.[1] ?? server.name;

  return server.rssBytes < 128 * MiB
    ? `${label} with nothing loaded`
    : `${label} ${sizeOf(server.rssBytes)}`;
};

export interface ModelServerMemory {
  readonly rssBytes: number;
  readonly processes: number;
  readonly servers?:
    | ReadonlyArray<{ readonly name: string; readonly rssBytes: number }>
    | undefined;
}

/** Each model server on the Client with its memory, or that none runs; null while unknown. */
export const memoryLine = (resources: ModelServerMemory | null, clientName: string) => {
  if (resources === null) return null;

  const where = inSentence(clientName);

  if (resources.processes === 0) return `No model server running on ${where}`;

  const servers = resources.servers ?? [{ name: "Model server", rssBytes: resources.rssBytes }];

  const parts = servers.map(serverPart).join(" · ");

  return `On ${where}: ${parts} · counted apart from Polaris`;
};
