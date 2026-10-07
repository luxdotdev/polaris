import type * as P from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import {
  decisionOf,
  providerName,
  trustScopeKey,
  type TrustAsk,
  type TrustPhase,
  type TrustStatus,
} from "./model.ts";

interface TrustState {
  /** Open asks by scope key. */
  readonly asks: Readonly<Record<string, TrustAsk>>;
  /** Each open file's scope key, so every file of a Workspace or its Worktrees shares one ask. */
  readonly files: Readonly<Record<string, string>>;
  /** The revision each scope was last decided at; an ask at or below it never shows again. */
  readonly settled: Readonly<Record<string, number>>;
  /** The latest status per scope, for which TypeScript runs. */
  readonly statuses: Readonly<Record<string, TrustStatus>>;
}

export const trustStore = createStore<TrustState>(() => ({
  asks: {},
  files: {},
  settled: {},
  statuses: {},
}));

const without = <V>(record: Readonly<Record<string, V>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export interface TrustTarget {
  readonly hostKey: string;
  readonly checkout: P.LanguageCheckout;
  readonly path: string;
}

/** Folds a Trust status from the Daemon (discovery or a change) into the open asks. */
export const trustStatusArrived = (target: TrustTarget, status: TrustStatus) => {
  const key = trustScopeKey(target.hostKey, status.trust.scope);
  const known = trustStore.getState().statuses[key];

  if (known === undefined || known.trust.revision <= status.trust.revision)
    trustStore.setState((state) => ({ statuses: { ...state.statuses, [key]: status } }));

  trustStore.setState((state) => {
    const current = state.asks[key];

    if (decisionOf(status.trust) !== "undecided") {
      return {
        asks: without(state.asks, key),
        settled: { ...state.settled, [key]: status.trust.revision },
      };
    }

    if (current !== undefined) {
      return current.phase.kind === "submitting"
        ? state
        : { asks: { ...state.asks, [key]: { ...current, status } } };
    }

    const settled = state.settled[key];

    if (!status.ask || (settled !== undefined && status.trust.revision <= settled)) return state;

    return { asks: { ...state.asks, [key]: { ...target, status, phase: { kind: "asking" } } } };
  });
};

/** Discovery tells which scope a file belongs to, and may carry the Daemon's ask. */
export const trustDiscovered = (
  target: TrustTarget,
  file: string,
  discovery: typeof P.LanguageDiscovery.Type
) => {
  const key = trustScopeKey(target.hostKey, discovery.trust.scope);

  trustStore.setState((state) =>
    state.files[file] === key ? state : { files: { ...state.files, [file]: key } }
  );

  if (discovery.trustRequest != null) trustStatusArrived(target, discovery.trustRequest);
};

export const setTrustPhase = (key: string, phase: TrustPhase) =>
  trustStore.setState((state) => {
    const current = state.asks[key];

    return current === undefined
      ? state
      : { asks: { ...state.asks, [key]: { ...current, phase } } };
  });

export const useTrustAsk = (file: string) => {
  const key = useStore(trustStore, (state) => state.files[file] ?? null);
  const ask = useStore(trustStore, (state) => (key === null ? null : (state.asks[key] ?? null)));

  return key === null || ask === null ? null : { key, ask };
};

const statusOf = (state: TrustState, file: string) => {
  const key = state.files[file];

  return key === undefined ? null : (state.statuses[key] ?? null);
};

/** The provider's name for an open file, from the Daemon's latest Trust status for its scope. */
export const providerLabel = (file: string, providerId: string) =>
  providerName(providerId, statusOf(trustStore.getState(), file));

export const useProviderLabels = (file: string, providerIds: readonly string[]) => {
  const status = useStore(trustStore, (state) => statusOf(state, file));

  return providerIds.map((id) => providerName(id, status));
};

/** The Daemon's latest Trust status for an open file's scope, if discovery has placed it. */
export const useTrustStatus = (file: string) =>
  useStore(trustStore, (state) => statusOf(state, file));
