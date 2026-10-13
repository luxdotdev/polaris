/** The status card's fact rows that need more than a field: placement, latency and context. */
import { hostCanServe } from "@polaris/client/prediction/score";
import type { PredictionServerKind } from "@polaris/protocol";
import type { Fact } from "../../status/model.ts";
import type { CompletionStatus } from "../store.ts";
import type { CardInput, CardTarget } from "./model.ts";

export const SERVER_NAMES: Record<Exclude<PredictionServerKind, "unknown">, string> = {
  "llama-server": "llama-server",
  ollama: "Ollama",
  "lm-studio": "LM Studio",
};

const GiB = 1024 ** 3;

type Report = NonNullable<CardInput["inspection"]>["client"];

const hasModels = (report: Report | null | undefined) =>
  report?.endpoints.some((endpoint) => endpoint.models.length > 0) ?? false;

const large = (report: Report) => report.machine.ramBytes >= 16 * GiB;

/** Why Auto chose this side over the other, as far as the probe can tell. */
const autoReason = (input: CardInput, target: CardTarget): string | null => {
  const inspection = input.inspection;

  if (inspection === undefined) return null;
  const client = inspection.client;
  const host = inspection.host;
  const clientName = target.side === "client" ? target.machine : null;

  if (target.side === "client") {
    if (host === null || clientName === input.hostName) return null;

    if (!hostCanServe(host.machine)) return "host too small";

    if (!hasModels(host)) return "the only model server";

    return large(client) && !large(host) ? "more memory" : "both can serve";
  }

  if (!hasModels(client)) return "the only model server";

  return host !== null && large(host) && !large(client) ? "more memory" : "measured faster";
};

export const placementNote = (input: CardInput, target: CardTarget): string => {
  const placement = input.preferences.placement;

  if (placement === "client") return "set to this machine";

  if (placement === "host") return "set to this host";
  const reason = autoReason(input, target);

  return reason === null ? "auto" : `auto · ${reason}`;
};

const ms = (value: number) => `${Math.round(value)} ms`;

const fromTarget = (result: CompletionStatus | undefined, target: CardTarget) =>
  target.served ? result : undefined;

/** The median round trip on this side and endpoint, the last one and how many it covers. */
export const latencyFact = (
  result: CompletionStatus | undefined,
  target: CardTarget
): ReadonlyArray<Fact> => {
  const latency = fromTarget(result, target)?.latency;

  if (latency === undefined || latency === null) return [];

  return [
    {
      label: "Latency",
      value: ms(latency.p50),
      note: `p50 of ${latency.count} · last ${ms(latency.last)}`,
    },
  ];
};

const tokens = (count: number) =>
  count >= 1000 ? `~${(count / 1000).toFixed(1)}k tokens` : `~${count} tokens`;

/** What the Host sent with the last completion; before one, only whether trust allows more. */
export const contextFact = (
  result: CompletionStatus | undefined,
  target: CardTarget,
  trusted: boolean | null
): ReadonlyArray<Fact> => {
  const context = fromTarget(result, target)?.context;
  const later = "language server after trust";

  if (context === null)
    return [{ label: "Context", value: "None", note: "this host's daemon sends none" }];

  if (context === undefined) {
    if (trusted === null) return [];

    return [
      trusted
        ? { label: "Context", value: "With the language server" }
        : { label: "Context", value: "Nearby code only", note: later },
    ];
  }

  const note =
    context.languageServer > 0
      ? `${context.languageServer} language-server pieces`
      : trusted === false
        ? later
        : "no language-server pieces";

  return [
    { label: "Context", value: context.pieces === 0 ? "None" : tokens(context.tokens), note },
  ];
};
