/**
 * The tab's own UI state, per Lead: what the Intent column has focused, the selected row,
 * folds, filter and query, the Output tab, and an open review form. It outlives the view.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Filter, ReceiptResult, WorkerFacts } from "./model/index.ts";

/** What the Lead's Intent column shows instead of the Lead: a worker, or a handover. */
export type Focus =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "handover"; readonly revision: number };

export type ReviewMode = "accept" | "send-back";

export interface LeadUi {
  readonly focus: Focus | null;
  readonly selected: string | null;
  readonly folds: ReadonlyMap<string, boolean>;
  readonly filter: Filter;
  readonly query: string;
  readonly tab: "constellation" | "changes";
  /** The row whose ⋯ menu is open (the a / s keys and previews open it too). */
  readonly menu: string | null;
  /** The Claim card's review form, open on one Attempt. */
  readonly review: { readonly attemptId: string; readonly mode: ReviewMode } | null;
}

const EMPTY: LeadUi = {
  focus: null,
  selected: null,
  folds: new Map(),
  filter: "all",
  query: "",
  tab: "constellation",
  menu: null,
  review: null,
};

const store = createStore<Readonly<Record<string, LeadUi>>>(() => ({}));

export const leadKey = (hostKey: string, leadSessionId: string) =>
  `${hostKey}\u0000${leadSessionId}`;

export const useLeadUi = (key: string): LeadUi => useStore(store, (s) => s[key] ?? EMPTY);

export const leadUi = (key: string): LeadUi => store.getState()[key] ?? EMPTY;

export const patchLeadUi = (key: string, patch: (ui: LeadUi) => Partial<LeadUi>) =>
  store.setState((s) => {
    const current = s[key] ?? EMPTY;

    return { ...s, [key]: { ...current, ...patch(current) } };
  });

/**
 * Facts the renderer can't derive yet (liveness from the Harness slice, lease waits, handed-up
 * Claims), set by previews and, later, by the feeds that carry them. Keyed by Host.
 */
export interface Signals {
  readonly workers: ReadonlyMap<string, Partial<WorkerFacts>>;
  readonly receipts: ReadonlyMap<string, ReceiptResult>;
  readonly handedUp: ReadonlySet<string>;
  readonly leadContext: ReadonlyMap<string, number>;
}

export const NO_SIGNALS: Signals = {
  workers: new Map(),
  receipts: new Map(),
  handedUp: new Set(),
  leadContext: new Map(),
};

const signals = createStore<Signals>(() => NO_SIGNALS);

export const useSignals = (): Signals => useStore(signals, (s) => s);

export const setSignals = (patch: Partial<Signals>) => signals.setState(patch);
