import { CommandId, type ConstellationId, SessionId, type TurnId } from "@polaris/protocol";
import { Effect, Predicate, Option } from "effect";
import { decideSession } from "../../engine/session.ts";
import { EventStore } from "../../store/EventStore.ts";
import { foldSession, patchSession } from "../../store/model.ts";
import { McpTokens, revokeMcpBindings } from "../../mcp/index.ts";
import { selectWorker } from "../../harness/constellation/worker.ts";
import { decideConstellationJournal } from "../journal.ts";
import { ConstellationOwner, type ConstellationRuntimeService } from "../runtime.ts";
import { ConstellationSessionEffects } from "../delivery/inputs.ts";
import { journalContext } from "../delivery/journal.ts";
import { newTurn, startedTurn, waitForBoundary } from "../delivery/turns.ts";
import { handoverHeader } from "./header.ts";
import { handoverPrompt } from "./prompt.ts";

export const withHandoverPreparation = (
  runtime: ConstellationRuntimeService
): ConstellationRuntimeService => ({
  ...runtime,
  prepare: Effect.fnUntraced(function* (binding, command, model, commandId) {
    if (Predicate.isTagged(command, "SetState") && Predicate.isTagged(command.action, "HandOver"))
      return {
        attempts: [],
        newLeadSessionId: null,
        claimProbe: null,
        recordedChecks: [],
        handoverDeferred: true,
      };

    return yield* runtime.prepare(binding, command, model, commandId);
  }),
});

const finalSummary = Effect.fnUntraced(function* (turnId: TurnId) {
  const store = yield* EventStore;
  const model = yield* store.model;

  const items =
    (yield* store.readTurnItems({ turnIds: [turnId], upTo: model.sequence })).get(turnId) ?? [];

  return items
    .flatMap((item) => (Predicate.isTagged(item, "AssistantMessage") ? [item.text] : []))
    .join("\n\n");
});

const summarize = Effect.fn("Constellation.summarizeLead")(function* (
  id: ConstellationId,
  requestId: string
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;
  const graph = (yield* store.model).constellations.get(id);
  const request = graph?.handoverRequest;

  if (request?.requestId !== requestId) return "";

  if (request.interrupt) yield* effects.interrupt(request.from);
  yield* waitForBoundary(request.from);

  const commit = yield* store.commit({
    commandId: CommandId.make(`${requestId}:summary`),
    decide: (model) => {
      const current = model.constellations.get(id)?.handoverRequest;
      const record = model.sessions.get(request.from);

      if (
        current?.requestId !== requestId ||
        record === undefined ||
        record.session.state === "failed" ||
        record.session.state === "needs-you" ||
        record.session.state === "in-terminal"
      )
        return Effect.succeed([]);

      return Effect.succeed(
        decideSession(record, {
          type: "turn.send",
          turn: newTurn(
            record.session,
            handoverPrompt(request.summary),
            new Date().toISOString(),
            `${requestId}:summary`
          ),
        }).events
      );
    },
  });

  if (Predicate.isTagged(commit, "Committed")) {
    const turn = startedTurn(commit.envelopes.map((e) => e.event));

    if (turn !== undefined) yield* effects.runTurn(turn, turn.prompt);
  }

  yield* waitForBoundary(request.from);
  const record = (yield* store.model).sessions.get(request.from);
  const turn = record?.turns.find((t) => t.id === `${requestId}:summary`);

  return turn?.status === "completed" ? yield* finalSummary(turn.id) : "";
});

/** The request stays durable while waiting; the final switch and both Session-machine transitions commit together. */
export const performHandover = Effect.fn("Constellation.performHandover")(function* (
  id: ConstellationId,
  requestId: string
) {
  const summary = yield* summarize(id, requestId);
  const store = yield* EventStore;
  const owner = yield* ConstellationOwner;
  const effects = yield* ConstellationSessionEffects;

  return yield* Effect.uninterruptible(
    Effect.gen(function* () {
      const result = yield* store.commit({
        commandId: null,
        decide: (model) => {
          const graph = model.constellations.get(id);
          const request = graph?.handoverRequest;

          const old =
            request === undefined || request === null
              ? undefined
              : model.sessions.get(request.from);

          if (
            graph === undefined ||
            request?.requestId !== requestId ||
            graph.graph.hostId !== owner ||
            old === undefined ||
            old.turns.some((t) => t.status === "working")
          )
            return Effect.succeed([]);
          const at = new Date().toISOString();
          const to = SessionId.make(`${requestId}:lead`);

          if (model.sessions.has(to)) return Effect.succeed([]);
          const selection = selectWorker(request.selection, null, null, old.session);

          const session = patchSession(old.session, {
            ...selection,
            id: to,
            title: `${graph.graph.name} · Lead`,
            state: "dormant",
            parentSessionId: null,
            forkedFromTurnId: null,
            harnessCursor: null,
            turnCount: 0,
            contextUsage: null,
            lastError: null,
            createdAt: at,
            updatedAt: at,
          });

          const fork = decideSession(undefined, { type: "session.fork", session }).events;
          const fresh = foldSession(to, undefined, fork, at);
          const archive = decideSession(old, { type: "session.archive", at });

          if (fresh === undefined || archive.rejection !== null) return Effect.succeed([]);

          const turn = newTurn(
            fresh.session,
            handoverHeader(graph, to, summary),
            at,
            `${requestId}:header`
          );

          const start = decideSession(fresh, { type: "turn.send", turn }).events;

          const decision = decideConstellationJournal(
            graph,
            {
              type: "handoverCompleted",
              requestId,
              summary,
              turnEvents: [...archive.events, ...fork, ...start],
            },
            {
              ...journalContext(graph, at),
              newLeadSessionId: to,
              occupiedSessions: new Set(model.sessions.keys()),
            }
          );

          return decision.rejection === null
            ? Effect.succeed(decision.events)
            : Effect.fail(decision.rejection);
        },
      });

      if (Predicate.isTagged(result, "Committed")) {
        const tokens = yield* Effect.serviceOption(McpTokens);

        if (Option.isSome(tokens))
          for (const { event } of result.envelopes)
            yield* revokeMcpBindings(event).pipe(Effect.provideService(McpTokens, tokens.value));
        const changed = result.envelopes.find((e) => Predicate.isTagged(e.event, "LeadChanged"));

        if (changed !== undefined && Predicate.isTagged(changed.event, "LeadChanged"))
          yield* effects.retire(changed.event.from);
        const turn = startedTurn(result.envelopes.map((e) => e.event));

        if (turn !== undefined) yield* effects.runTurn(turn, turn.prompt);
      }
    })
  );
});
