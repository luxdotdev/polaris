import {
  type CommandId,
  ConstellationCommand,
  type ConstellationId,
  ConstellationResult,
  ConstellationSettings,
  type CheckReceipt,
  type Sequence,
  type ToolCallReference,
  type TaskProjection,
} from "@polaris/protocol";
import { Context, Effect, Layer, Predicate } from "effect";
import { decideConstellation } from "../engine/constellation.ts";
import type {
  ConstellationBinding,
  ConstellationContext,
  RecordedCheck,
} from "../engine/constellation.inputs.ts";
import { type ConstellationRecord } from "../store/constellation.ts";
import { EventStore } from "../store/EventStore.ts";
import type { ReadModel } from "../store/model.ts";
import { getDefaults } from "./defaults.ts";
import { finding, refusal } from "./decision.ts";
import { ConstellationBranchStatus } from "./transfers/branches.ts";
import { ConstellationLiveness } from "./liveness.ts";
import { activeAttempt, projectTasks, enrichProjections } from "./projections.ts";
import { ConstellationOwner, ConstellationRuntime } from "./runtime.ts";
import { statusOutline } from "./status.ts";
import { subscribeConstellation } from "./streams.ts";

export const canRead = (binding: ConstellationBinding, record: ConstellationRecord) =>
  binding.kind === "user" ||
  binding.sessionId === record.graph.leadSessionId ||
  record.graph.attempts.some((a) => a.sessionId === binding.sessionId && activeAttempt(a));

const nextAction = (record: ConstellationRecord) => {
  if (record.graph.attempts.some((a) => a.state === "review")) return "Review the pending claims.";

  if ([...record.questions.values()].some((q) => q.answer === null))
    return "Answer the open questions.";

  return "Dispatch ready tasks or update the graph.";
};

export const graphResult = (
  record: ConstellationRecord,
  sequence: Sequence | null,
  json: boolean,
  projections: ReadonlyArray<TaskProjection> = projectTasks(record)
) =>
  new ConstellationResult({
    summary: statusOutline(record),
    next: nextAction(record),
    revision: record.graph.revision,
    sequence,
    constellation: json ? record.graph : null,
    projections: json ? [...projections] : [],
  });

const references = (command: ConstellationCommand): ReadonlyArray<ToolCallReference> => {
  let receipts: ReadonlyArray<CheckReceipt> = [];

  if (Predicate.isTagged(command, "Review") && Predicate.isTagged(command.action, "Accept"))
    receipts = command.action.receipts;

  if (Predicate.isTagged(command, "WorkerClaim")) receipts = command.claim.receipts;

  return receipts.flatMap((r) => (Predicate.isTagged(r, "Verified") ? [r.item] : []));
};

const occupied = (model: ReadModel, id: ConstellationId) =>
  new Set(
    [...model.constellations.values()]
      .filter((r) => r.graph.id !== id)
      .flatMap((r) => r.graph.attempts.filter(activeAttempt).map((a) => a.sessionId))
  );

const authorize = (model: ReadModel, id: ConstellationId, binding: ConstellationBinding) => {
  const record = model.constellations.get(id);

  if (record === undefined)
    return Effect.fail(
      refusal(undefined, [
        finding("E-NOT-FOUND", "The constellation does not exist", "Start it with plan."),
      ])
    );

  return canRead(binding, record)
    ? Effect.succeed(record)
    : Effect.fail(
        refusal(record, [
          finding(
            "E-AUTHORITY",
            "This session is not the current lead or an active worker",
            "Use the current session binding."
          ),
        ])
      );
};

const make = Effect.gen(function* () {
  const store = yield* EventStore;
  const hostId = yield* ConstellationOwner;
  const runtime = yield* ConstellationRuntime;
  const liveness = yield* ConstellationLiveness;
  const branches = yield* ConstellationBranchStatus;

  const status = Effect.fn("Constellations.status")(function* (
    binding: ConstellationBinding,
    id: ConstellationId,
    json: boolean
  ) {
    const record = yield* authorize(yield* store.model, id, binding);

    return graphResult(
      record,
      null,
      json,
      enrichProjections(record, yield* liveness.read(record), {
        fetchedAttempts: yield* branches.read(record.graph),
      })
    );
  });

  const resolve = Effect.fn("Constellations.resolve")(function* (
    binding: ConstellationBinding,
    id: ConstellationId,
    kind: "attempt" | "session" | "host" | "model",
    name: string
  ) {
    const model = yield* store.model;
    const record = yield* authorize(model, id, binding);
    let matches: ReadonlyArray<string> = [];

    if (kind === "attempt")
      matches = record.graph.attempts
        .filter(
          (a) =>
            a.id === name ||
            (a.taskId === name &&
              record.graph.attempts.findLast((other) => other.taskId === a.taskId)?.id === a.id)
        )
        .map((a) => a.id);

    if (kind === "session")
      matches = [...model.sessions.values()].flatMap((r) =>
        r.session.id === name || r.session.title === name ? [r.session.id] : []
      );

    if (kind === "host" && (name === hostId || name === "local")) matches = [hostId];

    if (kind === "model") return name;

    if (matches.length !== 1)
      return yield* refusal(record, [
        finding(
          "E-REFERENCE",
          `${kind} ${name} is unknown or ambiguous`,
          "Use an exact id from status."
        ),
      ]);

    return matches[0]!;
  });

  const command = Effect.fn("Constellations.command")(function* (
    binding: ConstellationBinding,
    commandId: CommandId,
    input: ConstellationCommand
  ) {
    const before = yield* store.model;

    if (before.constellations.has(input.constellationId))
      yield* authorize(before, input.constellationId, binding);
    const prepared = yield* runtime.prepare(binding, input, before, commandId);

    const defaults =
      Predicate.isTagged(input, "Plan") &&
      input.start !== undefined &&
      input.start.settings === undefined
        ? yield* getDefaults
        : ConstellationSettings.make({});

    const commit = yield* store
      .commit({
        commandId,
        decide: Effect.fnUntraced(
          function* (model: ReadModel) {
            const record = model.constellations.get(input.constellationId);

            if (Predicate.isTagged(input, "Plan") && input.start !== undefined) {
              const lead = model.sessions.get(input.start.leadSessionId);

              if (
                !model.workspaces.has(input.start.workspaceId) ||
                lead?.session.workspaceId !== input.start.workspaceId ||
                lead.session.state === "archived" ||
                (binding.kind === "session" && binding.sessionId !== input.start.leadSessionId)
              )
                return yield* refusal(record, [
                  finding(
                    "E-LEAD",
                    "Start requires a live lead in the registered workspace",
                    "Choose the lead session in this workspace."
                  ),
                ]);
            }

            const recordedChecks: Array<RecordedCheck> = [...prepared.recordedChecks];

            const claimReceipts = Predicate.isTagged(input, "Review")
              ? (record?.graph.attempts.find((a) => a.id === input.attemptId)?.claim?.receipts ??
                [])
              : [];

            const refs = [
              ...references(input),
              ...claimReceipts.flatMap((r) => (Predicate.isTagged(r, "Verified") ? [r.item] : [])),
            ];

            for (const ref of refs) {
              if (ref.hostId !== hostId || !model.sessions.has(ref.sessionId)) continue;

              const turn = (yield* store.readTurns({
                sessionId: ref.sessionId,
                beforeIndex: null,
                limit: null,
              })).find((t) => t.id === ref.turnId);

              if (turn === undefined) continue;

              const items = yield* store.readTurnItems({
                turnIds: [ref.turnId],
                upTo: model.sequence,
              });

              const item = items.get(ref.turnId)?.find((i) => i.id === ref.itemId);

              if (item !== undefined) recordedChecks.push({ reference: ref, item });
            }

            const resourceHolders = [...(model.hostResources?.resources.values() ?? [])].map(
              (resource) => ({
                hostId: resource.hostId,
                name: resource.name,
                holders: [...(model.hostResources?.leases.values() ?? [])].filter(
                  (lease) => lease.resource === resource.name
                ).length,
              })
            );

            const ctx: ConstellationContext = {
              ...prepared,
              binding,
              hostId,
              now: new Date().toISOString(),
              recordedChecks,
              resourceHolders,
              defaults,
              occupiedSessions: occupied(model, input.constellationId),
              offlineSessionIds: new Set(),
              commanded: true,
            };

            const decision = decideConstellation(record, input, ctx);

            if (decision.rejection !== null) return yield* decision.rejection;

            return decision.events;
          },
          Effect.catchTag("ServiceError", (error) =>
            Effect.fail(
              refusal(before.constellations.get(input.constellationId), [
                finding("E-STORE", error.message, "Retry with the same command id."),
              ])
            )
          )
        ),
      })
      .pipe(
        Effect.catchTag("ServiceError", (error) =>
          Effect.fail(
            refusal(before.constellations.get(input.constellationId), [
              finding("E-STORE", error.message, "Retry the command with the same id."),
            ])
          )
        )
      );

    if (Predicate.isTagged(commit, "Committed"))
      yield* runtime.afterCommit(binding, input, commit.envelopes);
    const model = Predicate.isTagged(commit, "Committed") ? commit.model : yield* store.model;
    const record = model.constellations.get(input.constellationId);

    if (record === undefined)
      return yield* refusal(undefined, [
        finding("E-NOT-FOUND", "The constellation does not exist", "Start it with plan."),
      ]);

    return graphResult(
      record,
      commit.sequence,
      true,
      enrichProjections(record, yield* liveness.read(record), {
        fetchedAttempts: yield* branches.read(record.graph),
      })
    );
  });

  return {
    command,
    status,
    resolve,
    subscribe: (binding: ConstellationBinding, id: ConstellationId, after: Sequence | null) =>
      subscribeConstellation(store, binding, id, after, liveness, branches),
  };
});

export class Constellations extends Context.Service<Constellations, Effect.Success<typeof make>>()(
  "polaris/daemon/constellation/Constellations"
) {
  static readonly layer = Layer.effect(Constellations, make);
}
