/**
 * Asking the reviewer from the phone (Paper MX-S) over the Desktop App's protocol: each question is
 * a `review.askFinding` on the finding, which continues the reviewer's own read-only session; the
 * answers are read off that session's feed.
 */
import {
  type RiskFindingId,
  type RiskSummary,
  type SessionId,
  type SessionStreamItem,
  type TurnId,
} from "@polaris/protocol";
import { Effect, Fiber, Stream } from "effect";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveHost } from "../../runtime/hostConnection.ts";
import { applySessionItem, type SessionFold } from "../../thread/fold.ts";
import { type Answer, answerOf } from "./answer.ts";

type AskState =
  | { readonly kind: "sending" }
  | { readonly kind: "sent"; readonly sessionId: SessionId; readonly turnId: TurnId }
  | { readonly kind: "failed"; readonly message: string };

interface Ask {
  readonly id: string;
  readonly question: string;
  readonly findingId: string;
  readonly state: AskState;
}

/** One question in a finding's thread and where its answer is. */
export interface AskEntry {
  readonly id: string;
  readonly question: string;
  readonly findingId: string;
  readonly answer: Answer;
}

/** Why the sheet can't send: null when it can. */
export const askBlocked = (live: LiveHost | null, summary: RiskSummary | null): string | null => {
  if (live === null) return "The host is offline";

  if (!live.capabilities.includes("review.ask")) return "This host can’t answer follow-ups yet";

  if (summary === null || summary.layers.agent.status === "running")
    return "The reviewer is still reading the change";

  if (summary.reviewer?.sessionId == null || summary.layers.agent.status !== "completed")
    return "Rules only: there’s no reviewer to ask";

  return null;
};

/** The reviewer's session folded from its feed while any answer is wanted. */
const useReviewerSession = (live: LiveHost | null, sessionId: SessionId | null) => {
  const [fold, setFold] = useState<SessionFold | null>(null);

  useEffect(() => {
    if (live === null || sessionId === null) return;

    const fiber = Effect.runFork(
      live.client.subscribeSession({ sessionId, afterSequence: null, turnLimit: 10 }).pipe(
        Stream.runForEach((item: SessionStreamItem) =>
          Effect.sync(() => setFold((state) => applySessionItem(state, item)))
        ),
        // A lost connection ends the feed; the next connection's `live` subscribes again.
        Effect.ignore
      )
    );

    return () => void Effect.runPromise(Fiber.interrupt(fiber));
  }, [live, sessionId]);

  return fold;
};

const answerFor = (ask: Ask, fold: SessionFold | null): Answer => {
  if (ask.state.kind === "failed") return { kind: "failed", text: ask.state.message };

  if (ask.state.kind === "sending") return { kind: "thinking", step: null };
  const { turnId } = ask.state;

  return answerOf(fold?.turns.find((t) => t.turn.id === turnId) ?? null);
};

const newId = () => `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const useAsks = (live: LiveHost | null, summary: RiskSummary | null) => {
  const [asks, setAsks] = useState<ReadonlyArray<Ask>>([]);

  const put = useCallback(
    (ask: Ask) => setAsks((list) => [...list.filter((a) => a.id !== ask.id), ask]),
    []
  );

  const sent = asks.find((a) => a.state.kind === "sent");
  const sessionId = sent?.state.kind === "sent" ? sent.state.sessionId : null;
  const fold = useReviewerSession(live, sessionId);

  const ask = useCallback(
    (findingId: RiskFindingId, question: string) => {
      if (live === null || summary === null || question.trim() === "") return;
      const base = { id: newId(), question: question.trim(), findingId };

      put({ ...base, state: { kind: "sending" } });

      const request = live.client["review.askFinding"]({
        summaryId: summary.id,
        findingId,
        question: base.question,
      }).pipe(
        Effect.match({
          onSuccess: (r): AskState => ({ kind: "sent", sessionId: r.sessionId, turnId: r.turnId }),
          onFailure: (error): AskState => ({ kind: "failed", message: error.message }),
        })
      );

      void Effect.runPromise(request).then((state) => put({ ...base, state }));
    },
    [live, summary, put]
  );

  const entries = useMemo(
    () =>
      asks.map((a): AskEntry => ({
        id: a.id,
        question: a.question,
        findingId: a.findingId,
        answer: answerFor(a, fold),
      })),
    [asks, fold]
  );

  return { asks: entries, ask, blocked: askBlocked(live, summary) };
};
