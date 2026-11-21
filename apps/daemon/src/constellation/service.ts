import {
  type Capability,
  type CommandId,
  ConstellationCommand,
  type ConstellationId,
  ConstellationResult,
  ConstellationProposal,
  ConstellationSettings,
  type CheckReceipt,
  type Sequence,
  type TaskProjection,
  inspecting,
} from "@polaris/protocol";
import { Context, Effect, Layer, Predicate } from "effect";
import { decideConstellation } from "../engine/constellation.ts";
import type {
  ConstellationBinding,
  ConstellationContext,
  RecordedCheck,
} from "../engine/constellation.inputs.ts";
import { type ConstellationRecord, stampKey } from "../store/constellation.ts";
import { EventStore } from "../store/EventStore.ts";
import { eventCapability, type ReadModel } from "../store/model.ts";
import { getDefaults } from "./defaults.ts";
import { finding, refusal } from "./decision.ts";
import { ConstellationBranchStatus } from "./transfers/branches.ts";
import { ConstellationLiveness } from "./liveness.ts";
import { activeAttempt, projectTasks, enrichProjections } from "./projections.ts";
import { ConstellationOwner, ConstellationRuntime } from "./runtime.ts";
import { emptyResources } from "../resources/model.ts";
import { type HostSlots } from "./slots.ts";
import { statusOutline, statusSince } from "./status.ts";
import { ignoredTierNotes } from "./serviceTier.ts";
import { scopedResult, statusScope, type StatusView } from "./statusView.ts";
import { type LogbookScope, readLogbook, subscribeLogbook } from "./logbook/index.ts";
import { subscribeConstellation } from "./streams.ts";
import {
  graphFree,
  prepareVerdict,
  verdictResult,
  type VerdictPreparation,
} from "./inspection/verdict.ts";
import { fenced, reviewStep } from "./inspection/fence.ts";
import { recordedChecks } from "./recordedChecks.ts";

export const canRead = (binding: ConstellationBinding, record: ConstellationRecord) =>
  binding.kind === "user" ||
  binding.sessionId === record.graph.leadSessionId ||
  record.graph.attempts.some((a) => a.sessionId === binding.sessionId && activeAttempt(a));

const nextAction = (record: ConstellationRecord) => {
  if (record.graph.attempts.some((a) => a.state === "review" && !inspecting(a)))
    return "Review the pending claims.";

  if (record.graph.openQuestions.length > 0) return "Answer the open questions.";

  return "Dispatch ready tasks or update the graph.";
};

export const graphResult = (
  record: ConstellationRecord,
  sequence: Sequence | null,
  json: boolean,
  projections: ReadonlyArray<TaskProjection> = projectTasks(record),
  sessions?: ReadModel["sessions"],
  host?: HostSlots,
  view: StatusView = {}
) =>
  scopedResult(
    record,
    graphFullResult(record, sequence, json, projections, sessions, host, view),
    statusScope(record, view)
  );

const graphFullResult = (
  record: ConstellationRecord,
  sequence: Sequence | null,
  json: boolean,
  projections: ReadonlyArray<TaskProjection>,
  sessions: ReadModel["sessions"] | undefined,
  host: HostSlots | undefined,
  view: StatusView
) =>
  new ConstellationResult({
    summary: statusOutline(record, sessions, host, view),
    next: nextAction(record),
    revision: record.graph.revision,
    sequence,
    constellation: json ? record.graph : null,
    projections: json ? [...projections] : [],
    proposals: json
      ? [...record.proposals].map(
          ([proposalId, p]) =>
            new ConstellationProposal({
              proposalId,
              by: p.by,
              task: p.task,
              at: record.stamps.get(stampKey("proposal", proposalId)) ?? record.graph.updatedAt,
            })
        )
      : [],
  });

const references = (command: ConstellationCommand): ReadonlyArray<CheckReceipt> => {
  if (Predicate.isTagged(command, "Review") && Predicate.isTagged(command.action, "Accept"))
    return command.action.receipts;

  return Predicate.isTagged(command, "WorkerClaim") ? command.claim.receipts : [];
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
    json: boolean,
    view: StatusView = {}
  ) {
    const model = yield* store.model;
    const record = yield* authorize(model, id, binding);
    const { since, task } = view;

    if (task !== undefined && !record.graph.tasks.some((t) => t.id === task))
      return yield* refusal(record, [
        finding("E-TASK-UNKNOWN", `Task ${task} does not exist`, "Read status for the Task ids."),
      ]);
    const observed = yield* liveness.read(record);

    const host: HostSlots = {
      hostId,
      resources: model.hostResources ?? emptyResources(),
      constellations: model.constellations,
      sessions: model.sessions,
      now: Date.now(),
      liveness: observed,
    };

    const result = graphResult(
      record,
      null,
      json,
      enrichProjections(record, observed, {
        fetchedAttempts: yield* branches.read(record.graph),
      }),
      model.sessions,
      host,
      view
    );

    if (since === undefined) return result;

    // A read of this graph's own stream; the Lead asks for it, no timer does.
    const events = yield* store
      .readConstellationEvents({ constellationId: id, after: 0, upTo: model.sequence })
      .pipe(
        Effect.mapError((error) =>
          refusal(record, [finding("E-STORE", error.message, "Retry status without since.")])
        )
      );

    return new ConstellationResult({
      summary: statusSince(record, events, since, model.sessions, host, view),
      next: result.next,
      revision: result.revision,
      sequence: result.sequence,
      constellation: result.constellation,
      projections: result.projections,
      proposals: result.proposals,
    });
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
      matches = [
        ...new Set([
          ...[...model.sessions.values()].flatMap((r) =>
            r.session.id === name || r.session.title === name ? [r.session.id] : []
          ),
          ...record.graph.attempts.filter((a) => a.sessionId === name).map((a) => a.sessionId),
        ]),
      ];

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

  /** A reference this Host can't read is left out; the decider refuses the receipt. */
  const checksOf = (model: ReadModel, receipts: ReadonlyArray<CheckReceipt>) =>
    recordedChecks(
      store,
      hostId,
      model,
      receipts.flatMap((r) => (Predicate.isTagged(r, "Verified") ? [r.item] : []))
    );

  /** Prepare against the model as it stands, then commit; a review step runs this fenced. */
  const committed = Effect.fnUntraced(function* (
    binding: ConstellationBinding,
    commandId: CommandId,
    input: ConstellationCommand
  ) {
    const before = yield* store.model;

    const storeRefused = (error: { readonly message: string }) =>
      refusal(before.constellations.get(input.constellationId), [
        finding("E-STORE", error.message, "Retry the command with the same id."),
      ]);

    // A verdict names its own writer; the decider checks the Inspector's binding itself.
    if (before.constellations.has(input.constellationId) && !Predicate.isTagged(input, "Inspect"))
      yield* authorize(before, input.constellationId, binding);

    const prepared: VerdictPreparation = Predicate.isTagged(input, "Inspect")
      ? yield* prepareVerdict(
          runtime,
          (attempt) =>
            Effect.zipWith(
              Effect.mapError(checksOf(before, attempt.claim?.receipts ?? []), storeRefused),
              runtime.relayedChecks?.(attempt) ?? Effect.succeed([]),
              (local, relayed) => [...local, ...relayed]
            ),
          { binding, input, model: before, commandId }
        )
      : yield* runtime.prepare(binding, input, before, commandId);

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

            // A verdict's Accept stands on the Claim's own receipts, as a Lead's Accept does.
            const claimReceipts =
              Predicate.isTagged(input, "Review") || Predicate.isTagged(input, "Inspect")
                ? (record?.graph.attempts.find((a) => a.id === input.attemptId)?.claim?.receipts ??
                  [])
                : [];

            const recorded: ReadonlyArray<RecordedCheck> = [
              ...prepared.recordedChecks,
              ...(yield* checksOf(model, [...references(input), ...claimReceipts])),
            ];

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
              recordedChecks: recorded,
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
      .pipe(Effect.catchTag("ServiceError", (error) => Effect.fail(storeRefused(error))));

    return { commit, prepared };
  });

  const decided = Effect.fn("Constellations.command")(function* (
    binding: ConstellationBinding,
    commandId: CommandId,
    input: ConstellationCommand
  ) {
    const verdict = Predicate.isTagged(input, "Inspect");
    const step = committed(binding, commandId, input);

    // Preparing a verdict merges: nothing that could end its Inspection runs beside it.
    const { commit, prepared } = yield* reviewStep(input)
      ? fenced(store, input.constellationId, step)
      : step;

    if (Predicate.isTagged(commit, "Committed"))
      yield* runtime.afterCommit(binding, input, commit.envelopes);
    const model = Predicate.isTagged(commit, "Committed") ? commit.model : yield* store.model;
    const record = model.constellations.get(input.constellationId);

    if (record === undefined)
      return yield* refusal(undefined, [
        finding("E-NOT-FOUND", "The constellation does not exist", "Start it with plan."),
      ]);

    if (verdict) return verdictResult(record.graph.revision, commit.sequence);

    const result = graphResult(
      record,
      commit.sequence,
      true,
      enrichProjections(record, yield* liveness.read(record), {
        fetchedAttempts: yield* branches.read(record.graph),
      }),
      model.sessions
    );

    const notes = Predicate.isTagged(commit, "Committed")
      ? ignoredTierNotes(input, record, prepared.attempts, model.sessions)
      : [];

    return notes.length === 0
      ? result
      : new ConstellationResult({
          summary: result.summary,
          next: [...notes, result.next].join(" "),
          revision: result.revision,
          sequence: result.sequence,
          constellation: result.constellation,
          projections: result.projections,
          proposals: result.proposals,
        });
  });

  const command = (
    binding: ConstellationBinding,
    commandId: CommandId,
    input: ConstellationCommand
  ) =>
    Predicate.isTagged(input, "Inspect")
      ? decided(binding, commandId, input).pipe(Effect.mapError(graphFree))
      : decided(binding, commandId, input);

  return {
    command,
    status,
    resolve,
    /** `capabilities`: what the Client announced; absent sends every event. */
    subscribe: (
      binding: ConstellationBinding,
      id: ConstellationId,
      after: Sequence | null,
      capabilities?: ReadonlyArray<Capability>
    ) =>
      subscribeConstellation(
        store,
        binding,
        id,
        after,
        liveness,
        branches,
        capabilities === undefined
          ? undefined
          : (event) => {
              const needed = eventCapability(event);

              return needed === null || capabilities.includes(needed);
            }
      ),
    /**
     * A Task's Logbook, with its access check. A note goes through `command` as a `Note`: the
     * decider applies the write rule.
     */
    logbook: {
      read: (binding: ConstellationBinding, scope: LogbookScope) =>
        readLogbook(store, binding, scope),
      subscribe: (binding: ConstellationBinding, scope: LogbookScope) =>
        subscribeLogbook(store, binding, scope),
    },
  };
});

export class Constellations extends Context.Service<Constellations, Effect.Success<typeof make>>()(
  "polaris/daemon/constellation/Constellations"
) {
  static readonly layer = Layer.effect(Constellations, make);
}
