import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { languageIpcError } from "../../../../shared/languageError.ts";
import { decisionOf, type TrustAsk, type TrustDecision } from "./model.ts";
import { setTrustPhase, trustStatusArrived, trustStore, type TrustTarget } from "./store.ts";

const decodeStatus = Schema.decodeUnknownSync(P.LanguageTrustStatus);

/** After a revision conflict, read the scope again: another Client may already have decided. */
const reinspect = async (api: LanguageApi, ask: TrustAsk) => {
  const inspected = await api.request("languages.trust.inspect", {
    hostKey: ask.hostKey,
    checkout: ask.checkout,
    path: ask.path,
  });

  if (!inspected.ok) return false;
  const status = decodeStatus(inspected.value);
  trustStatusArrived(ask, status);

  return decisionOf(status.trust) !== "undecided";
};

/** Reads Trust again for a file's scope, e.g. after a change made elsewhere replaced its context. */
export const refreshTrust = async (api: LanguageApi, target: TrustTarget) => {
  const inspected = await api.request("languages.trust.inspect", {
    hostKey: target.hostKey,
    checkout: target.checkout,
    path: target.path,
  });

  if (inspected.ok) trustStatusArrived(target, decodeStatus(inspected.value));
};

/** Sends Trust or Not now for the ask at `key`; failures stay on the card as typed errors. */
export const decideTrust = async (api: LanguageApi, key: string, action: TrustDecision) => {
  const ask = trustStore.getState().asks[key];

  if (ask === undefined || ask.phase.kind === "submitting") return;
  setTrustPhase(key, { kind: "submitting", action });

  const result = await api
    .request("languages.trust.change", {
      hostKey: ask.hostKey,
      checkout: ask.checkout,
      path: ask.path,
      action,
      expectedRevision: ask.status.trust.revision,
    })
    .catch((cause: unknown) => ({
      ok: false as const,
      error: { code: "unavailable", message: String(cause) },
    }));

  if (result.ok) {
    setTrustPhase(key, { kind: "asking" });
    trustStatusArrived(ask, decodeStatus(result.value));

    return;
  }

  const error = languageIpcError(result.error);

  if (error.reason === "conflict" && (await reinspect(api, ask).catch(() => false))) return;
  setTrustPhase(key, { kind: "failed", action, error });
};

/**
 * Any Trust change from this Client (the palette's revoke and ask again too). The Daemon puts a
 * fresh ask in the change's answer, so folding it here is what brings the card back.
 */
export const changeTrust = async (
  api: LanguageApi,
  target: TrustTarget,
  action: typeof P.LanguageTrustAction.Type,
  expectedRevision: number
) => {
  const result = await api.request("languages.trust.change", {
    ...target,
    action,
    expectedRevision,
  });

  if (!result.ok) throw languageIpcError(result.error);
  const status = decodeStatus(result.value);
  trustStatusArrived(target, status);

  return status;
};
