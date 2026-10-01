/**
 * The open Review's Risk Summary: started (or answered from the Host's cache) with
 * `review.runRiskSummary` when the Review opens, then followed live with
 * `review.watchRiskSummary`. Its findings go into the Review surface, where the diff draws
 * their gutter marks and reason rows.
 */
import type {
  ReviewCheckoutId,
  ReviewContext,
  ReviewSubject as ProtocolSubject,
  RiskSummaryId,
  WorkspaceId,
} from "@polaris/protocol";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Plain } from "../../../store/plain.ts";
import { polaris } from "../../bridge.ts";
import { updateSurface } from "../../review/index.ts";
import type { Summary } from "../model/summary.ts";

export type RiskState =
  /** Nothing to summarise yet: the pull request has no Review Checkout, or the session no Turns. */
  | { readonly kind: "waiting" }
  | { readonly kind: "starting" }
  | { readonly kind: "ready"; readonly hostKey: string; readonly summary: Summary }
  | { readonly kind: "failed"; readonly message: string };

const WAITING: RiskState = { kind: "waiting" };

export const riskStore = createStore<Readonly<Record<string, RiskState>>>(() => ({}));

export const useRisk = (subjectKey: string): RiskState =>
  useStore(riskStore, (s) => s[subjectKey] ?? WAITING);

export const riskOf = (subjectKey: string): RiskState =>
  riskStore.getState()[subjectKey] ?? WAITING;

/** What the diff draws of the findings; the surface changes only when this does. */
const findingsSignature = (summary: Summary) =>
  summary.findings
    .map((f) => `${f.id}:${f.status}:${f.severity}:${f.lines.start}-${f.lines.end}`)
    .join(",");

const drawn = new Map<string, string>();

const set = (subjectKey: string, state: RiskState) => {
  riskStore.setState({ [subjectKey]: state });

  if (state.kind !== "ready") return;
  const signature = findingsSignature(state.summary);

  // Every layer change re-sends the summary; redrawing every file's marks for it would jank.
  if (drawn.get(subjectKey) === signature) return;
  drawn.set(subjectKey, signature);
  updateSurface(subjectKey, { findings: state.summary.findings });
};

/** What `review.runRiskSummary` needs, minus `refresh`. */
export interface RiskRequest {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  readonly subject: ProtocolSubject;
  readonly checkoutId: ReviewCheckoutId | null;
  readonly since: string | null;
  readonly context: Plain<ReviewContext> | null;
}

/** The feed following each subject's summary, closed when the subject closes or moves on. */
const watches = new Map<
  string,
  { readonly summaryId: RiskSummaryId; readonly close: () => void }
>();

const watch = (subjectKey: string, hostKey: string, summaryId: RiskSummaryId) => {
  if (watches.get(subjectKey)?.summaryId === summaryId) return;
  watches.get(subjectKey)?.close();

  const close = polaris().subscribe(
    "review.watchRiskSummary",
    { hostKey, summaryId },
    {
      items: (items) => {
        const summary = items.at(-1);

        if (summary !== undefined && watches.get(subjectKey)?.summaryId === summaryId) {
          set(subjectKey, { kind: "ready", hostKey, summary });
        }
      },
      // A dropped connection ends the feed; the next open (or reconnect) runs again.
      end: () => {
        if (watches.get(subjectKey)?.summaryId === summaryId) watches.delete(subjectKey);
      },
    }
  );

  watches.set(subjectKey, { summaryId, close });
};

export const stopWatching = (subjectKey: string) => {
  watches.get(subjectKey)?.close();
  watches.delete(subjectKey);
};

/** Runs (or reads the cached) summary and follows it; `refresh` runs again even when cached. */
export const runRiskSummary = async (subjectKey: string, request: RiskRequest, refresh = false) => {
  const before = riskOf(subjectKey);

  if (before.kind !== "ready") set(subjectKey, { kind: "starting" });

  const result = await polaris().request("review.runRiskSummary", { ...request, refresh });

  if (!result.ok) {
    if (before.kind !== "ready") set(subjectKey, { kind: "failed", message: result.error.message });

    return;
  }

  set(subjectKey, { kind: "ready", hostKey: request.hostKey, summary: result.value });
  // Followed even when finished: Verdicts and follow-ups still change it.
  watch(subjectKey, request.hostKey, result.value.id);
};

/** A stable key for a request: a new one (another head, another `since`) runs again. */
const requestKey = (request: RiskRequest) =>
  [
    request.hostKey,
    request.workspaceId,
    request.checkoutId ?? "",
    request.since ?? "",
    JSON.stringify(request.subject),
  ].join("\u0000");

/**
 * Keeps the open subject's summary current: runs when the request first appears or
 * changes (a checkout updated to a new head), and stops following it when the Review closes.
 */
export const useRiskSummary = (subjectKey: string, request: RiskRequest | null) => {
  const key = request === null ? null : requestKey(request);
  const latest = useRef(request);

  useEffect(() => {
    latest.current = request;
  });

  useEffect(() => {
    const current = latest.current;

    if (key === null || current === null) return undefined;
    void runRiskSummary(subjectKey, current);

    return () => stopWatching(subjectKey);
  }, [subjectKey, key]);

  return useRisk(subjectKey);
};
