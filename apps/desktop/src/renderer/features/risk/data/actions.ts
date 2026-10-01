/**
 * What the risk column does to a summary: record a Verdict (`RecordVerdict`, ENG-225), ask
 * the Reviewer a follow-up (`review.askFinding`, which continues its read-only session), and
 * read a Finding's earlier Verdicts ("You dismissed a similar finding here").
 */
import type {
  RiskFindingId,
  RiskSummaryId,
  SessionId,
  TurnId,
  Verdict,
  VerdictId,
  VerdictReason,
  VerdictScope,
} from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { Commands } from "../../../commands.ts";
import type { Plain } from "../../../store/plain.ts";
import { polaris } from "../../bridge.ts";
import { send } from "../../session/dispatch.ts";

export interface VerdictInput {
  readonly hostKey: string;
  readonly summaryId: RiskSummaryId;
  readonly findingId: RiskFindingId;
  readonly thumb: "up" | "down";
  readonly reasons: ReadonlyArray<VerdictReason>;
  readonly text: string | null;
  readonly scope: VerdictScope;
}

const newVerdictId = (): VerdictId =>
  // SAFETY: VerdictId is a branded string the Client chooses; any unique string is one.
  crypto.randomUUID() as VerdictId;

/** A thumbs-down moves the finding to Dismissed; the summary's feed brings the change. */
export const recordVerdict = (input: VerdictInput) =>
  send(
    input.hostKey,
    Commands.RecordVerdict({
      verdictId: newVerdictId(),
      summaryId: input.summaryId,
      findingId: input.findingId,
      thumb: input.thumb,
      reasons: input.thumb === "up" ? [] : input.reasons,
      text: input.text === null || input.text.trim() === "" ? null : input.text.trim(),
      scope: input.scope,
    }),
    "Couldn’t save the verdict"
  );

/** A question to the Reviewer and where its answer streams. */
export interface Ask {
  readonly id: string;
  readonly question: string;
  /** Null: about the whole change. */
  readonly findingId: string | null;
  readonly state:
    | { readonly kind: "sending" }
    | { readonly kind: "sent"; readonly sessionId: SessionId; readonly turnId: TurnId }
    | { readonly kind: "failed"; readonly message: string };
}

/** Per summary, newest last; kept for this launch. */
export const askStore = createStore<Readonly<Record<string, ReadonlyArray<Ask>>>>(() => ({}));

const EMPTY: ReadonlyArray<Ask> = [];

export const useAsks = (summaryId: string | null) =>
  useStore(askStore, (s) => (summaryId === null ? EMPTY : (s[summaryId] ?? EMPTY)));

const putAsk = (summaryId: string, ask: Ask) =>
  askStore.setState((s) => {
    const list = s[summaryId] ?? [];
    const at = list.findIndex((a) => a.id === ask.id);

    return {
      [summaryId]: at === -1 ? [...list, ask] : list.map((a, i) => (i === at ? ask : a)),
    };
  });

export const askReviewer = async (
  hostKey: string,
  summaryId: RiskSummaryId,
  findingId: RiskFindingId | null,
  question: string
) => {
  const base = { id: crypto.randomUUID(), question: question.trim(), findingId };

  putAsk(summaryId, { ...base, state: { kind: "sending" } });

  const result = await polaris().request("review.askFinding", {
    hostKey,
    summaryId,
    findingId,
    question: base.question,
  });

  putAsk(summaryId, {
    ...base,
    state: result.ok
      ? { kind: "sent", sessionId: result.value.sessionId, turnId: result.value.turnId }
      : { kind: "failed", message: result.error.message },
  });
};

/** Earlier Verdicts on findings with this identity, newest first; empty when the Host can't say. */
export const earlierVerdicts = async (
  hostKey: string,
  identity: string
): Promise<ReadonlyArray<Plain<Verdict>>> => {
  const result = await polaris().request("review.verdicts", {
    hostKey,
    repo: null,
    summaryId: null,
    identity,
    limit: 5,
  });

  return result.ok ? result.value : [];
};
