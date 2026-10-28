/**
 * Polaris's own notifications when a Constellation needs the user (ENG-462): a question to the
 * user and a Claim the Lead hands up. Each is a `SessionNotified` on the Lead's session, sent
 * once per cause, so the Desktop App and every Linked Device get it without the agent's `notify`.
 * Approvals already reach both as Needs You, so they aren't repeated here.
 */
import { liveQuestions, type SessionId } from "@polaris/protocol";
import { Effect, Predicate, Stream } from "effect";
import type { AutomaticInput, Notifier } from "../mcp/sessions/index.ts";
import { type ConstellationRecord, graphEvent } from "../store/constellation.ts";
import type { EventStore, LiveItem } from "../store/EventStore.ts";

const cut = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const LIVE = new Set(["planning", "running", "paused"]);

/** What in `record` waits on the user now, as the notification each one sends. Pure. */
export const attentionOf = (record: ConstellationRecord): ReadonlyArray<AutomaticInput> => {
  const { graph } = record;

  if (!LIVE.has(graph.state)) return [];
  const base = { sessionId: graph.leadSessionId, constellationId: graph.id };
  const attempt = (id: string) => graph.attempts.find((a) => a.id === id);

  const about = (sessionId: SessionId | undefined) =>
    sessionId === undefined || sessionId === graph.leadSessionId ? [] : [sessionId];

  const questions = liveQuestions(graph.openQuestions, graph.attempts)
    .filter((q) => q.question.to === "user")
    .map(({ attemptId, question }): AutomaticInput => {
      const asking = attempt(attemptId);

      return {
        ...base,
        about: about(asking?.sessionId),
        id: `attention:${graph.id}:question:${attemptId}:${question.id}`,
        title: cut(`${asking?.taskId ?? "A worker"} asks you`, 80),
        body: cut(question.text, 400),
      };
    });

  const claims = graph.attempts
    .filter((a) => a.state === "review" && a.handedUpAt !== null)
    .map((a): AutomaticInput => ({
      ...base,
      about: about(a.sessionId),
      id: `attention:${graph.id}:handup:${a.id}:${a.handedUpAt}`,
      title: cut(`${a.taskId}'s claim needs your review`, 80),
      body: cut(
        a.handedUpReason ?? graph.tasks.find((t) => t.id === a.taskId)?.title ?? a.taskId,
        400
      ),
    }));

  return [...questions, ...claims];
};

/**
 * Follows graph events for as long as the scope lives. What waited on the user when it started
 * stays quiet; each later cause notifies once, even across a reopen after falling behind.
 */
export const startAttention = Effect.fn("Constellation.startAttention")(function* (
  store: EventStore["Service"],
  notifications: Notifier
) {
  const known = new Set<string>();

  const scan = Effect.fnUntraced(function* (records: Iterable<ConstellationRecord>, send: boolean) {
    for (const record of records)
      for (const input of attentionOf(record)) {
        if (known.has(input.id)) continue;
        known.add(input.id);

        if (send) yield* notifications.automatic(input);
      }
  });

  const subscribe = store.subscribe({
    filter: (i) => Predicate.isTagged(i, "Event") && graphEvent(i.envelope.event) !== null,
  });

  const follow = (feed: Stream.Stream<LiveItem>) =>
    feed.pipe(
      Stream.runForEach((i) => {
        const graph = Predicate.isTagged(i, "Event") ? graphEvent(i.envelope.event) : null;

        if (graph === null) return Effect.void;

        return Effect.flatMap(store.model, (model) => {
          const record = model.constellations.get(graph.constellationId);

          return record === undefined ? Effect.void : scan([record], true);
        });
      })
    );

  // Subscribed before the first scan, so nothing committed in between is missed.
  const first = yield* subscribe;
  yield* scan((yield* store.model).constellations.values(), false);

  const reopen = Effect.scoped(
    Effect.gen(function* () {
      const feed = yield* subscribe;
      yield* scan((yield* store.model).constellations.values(), true);
      yield* follow(feed);
    })
  );

  const logged = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.andThen(
          Effect.logError("Constellation attention observer reopening", cause),
          Effect.sleep("1 second")
        )
      )
    );

  yield* follow(first).pipe(
    logged,
    Effect.andThen(logged(reopen).pipe(Effect.forever)),
    Effect.forkScoped
  );
});
