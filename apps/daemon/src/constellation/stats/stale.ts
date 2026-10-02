import type { AttemptId, EventEnvelope } from "@polaris/protocol";
import { Match } from "effect";
import { overlap } from "./intervals.ts";

export interface StaleTransition {
  readonly attemptId: AttemptId;
  readonly at: string;
  readonly stale: boolean;
}

export const staleTransitions = (
  events: ReadonlyArray<EventEnvelope>
): ReadonlyArray<StaleTransition> =>
  events.flatMap(({ event }) => {
    const fact = Match.value(event).pipe(
      Match.tags({
        AttemptStale: ({ attemptId, at }) => ({ attemptId, at, stale: true }),
        AttemptFresh: ({ attemptId, at }) => ({ attemptId, at, stale: false }),
      }),
      Match.orElse(() => null)
    );

    return fact === null ? [] : [fact];
  });

/** Integrate owner observations in stream order, retaining the first stale boundary. */
export const staleDuration = (
  transitions: ReadonlyArray<StaleTransition>,
  attemptId: AttemptId,
  start: number,
  end: number
): number => {
  let since: number | null = null;
  let total = 0;

  for (const fact of transitions) {
    if (fact.attemptId !== attemptId) continue;
    const at = Date.parse(fact.at);

    if (fact.stale) {
      since ??= at;
    } else if (since !== null) {
      total += overlap(since, at, start, end);
      since = null;
    }
  }

  return total + (since === null ? 0 : overlap(since, end, start, end));
};
