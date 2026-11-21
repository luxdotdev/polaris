import { expect, test } from "bun:test";
import {
  AgentSession,
  AttemptId,
  CommandId,
  type ConstellationCommand,
  ConstellationSettings,
  DomainEvent,
  PlanOperation,
  ReviewAction,
  SessionId,
  TaskId,
  WorkerPlacement,
  Workspace,
} from "@polaris/protocol";
import { Effect, Layer, Predicate, Schema } from "effect";
import type { ConstellationBinding } from "../../engine/constellation.inputs.ts";
import {
  A,
  AT,
  B,
  C,
  CID,
  HOST,
  LEAD,
  WS,
  draft,
  report,
  task,
} from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationOwner, ConstellationRuntime } from "../../constellation/runtime.ts";
import { Constellations } from "../../constellation/service.ts";
import { McpBinding } from "../binding.ts";
import { constellationTools } from "./index.ts";

/** D depends on A; B depends on nothing. */
const D = TaskId.make("D");

const WORKER = SessionId.make("worker");

const DEPENDENT = SessionId.make("dependent");

const PEER = SessionId.make("peer");

const session = (id: SessionId) =>
  new AgentSession({
    id,
    workspaceId: WS,
    harness: "codex",
    title: id,
    cwd: "/tmp",
    worktreeId: null,
    state: "idle",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
  });

/** A dispatch starts one Attempt per named Task on the session it names. */
const attemptsFor = (command: ConstellationCommand) =>
  Predicate.isTagged(command, "Dispatch")
    ? command.tasks.flatMap(({ taskId, worker }) =>
        Predicate.isTagged(worker, "Existing")
          ? [draft(taskId, `${taskId.toLowerCase()}1`, worker.sessionId)]
          : []
      )
    : [];

const layer = Constellations.layer.pipe(
  Layer.provideMerge(EventStore.layerSqlite(":memory:")),
  Layer.provide(Layer.succeed(ConstellationOwner)(HOST)),
  Layer.provide(
    Layer.succeed(ConstellationRuntime)({
      prepare: (_binding, command) =>
        Effect.succeed({
          attempts: attemptsFor(command),
          newLeadSessionId: null,
          claimProbe: { dirtyPaths: [], branch: "polaris/A", head: "head" },
          recordedChecks: [],
        }),
      afterCommit: () => Effect.void,
      resumeWorking: () => Effect.void,
    })
  )
);

let ids = 0;

/** A was claimed (after its worker noted a decision) and accepted; B and D are being worked. */
const world = Effect.gen(function* () {
  const store = yield* EventStore;
  const graphs = yield* Constellations;

  yield* store.commit({
    commandId: CommandId.make("seed"),
    decide: () =>
      Effect.succeed([
        DomainEvent.cases.WorkspaceRegistered.make({
          workspace: new Workspace({
            id: WS,
            path: "/tmp",
            name: "test",
            isGitRepo: true,
            worktreeRoot: "/tmp/trees",
            hidden: false,
            registeredAt: AT,
          }),
        }),
        ...[LEAD, WORKER, DEPENDENT, PEER].map((id) =>
          DomainEvent.cases.SessionCreated.make({ session: session(id) })
        ),
      ]),
  });

  const send = (binding: ConstellationBinding, command: ConstellationCommand) =>
    graphs.command(binding, CommandId.make(`c${ids++}`), command);

  const user = { kind: "user" as const };

  const dispatch = (taskId: TaskId, sessionId: SessionId) =>
    send(
      user,
      C.Dispatch.make({
        constellationId: CID,
        tasks: [{ taskId, worker: WorkerPlacement.cases.Existing.make({ sessionId }) }],
      })
    );

  yield* send(
    user,
    C.Plan.make({
      constellationId: CID,
      start: {
        name: "Build",
        workspaceId: WS,
        leadSessionId: LEAD,
        settings: new ConstellationSettings({}),
      },
      operations: [task(A), task(B), task(D, [A])].map((t) =>
        PlanOperation.cases.Add.make({ task: t })
      ),
    })
  );
  yield* dispatch(A, WORKER);
  yield* dispatch(B, PEER);

  return { graphs, send, dispatch };
});

const worker = (sessionId: SessionId, attemptId: string) =>
  McpBinding.cases.Worker.make({
    sessionId,
    constellationId: CID,
    attemptId: AttemptId.make(attemptId),
  });

const lead = McpBinding.cases.Lead.make({ sessionId: LEAD, constellationId: CID });

const call = (
  graphs: Constellations["Service"],
  binding: McpBinding,
  name: string,
  input: { readonly task?: string; readonly since?: number; readonly text?: string }
) =>
  Effect.promise(() =>
    constellationTools(binding, graphs)
      .find((tool) => tool.name === name)!
      .call(Schema.decodeUnknownSync(Schema.Json)(input))
  );

const text = (result: { readonly content: ReadonlyArray<{ readonly text: string }> }) =>
  result.content.map((c) => c.text).join("\n");

const run = <X, E>(effect: Effect.Effect<X, E, EventStore | Constellations>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)));

test("a dependent Task's worker reads its dependency's Logbook through the tool; a worker of an unrelated Task is refused with no graph", () =>
  run(
    Effect.gen(function* () {
      const { graphs, send, dispatch } = yield* world;
      const a = worker(WORKER, "a1");

      const noted = yield* call(graphs, a, "logbook_note", { text: "Keyed by sequence." });

      expect(noted.isError).toBeUndefined();
      yield* send(
        { kind: "session", sessionId: WORKER },
        C.WorkerClaim.make({
          constellationId: CID,
          attemptId: AttemptId.make("a1"),
          claim: report(),
        })
      );
      yield* send(
        { kind: "session", sessionId: LEAD },
        C.Review.make({
          constellationId: CID,
          attemptId: AttemptId.make("a1"),
          revision: (yield* graphs.status(
            { kind: "user" },
            CID,
            true
          )).constellation!.attempts.find((x) => x.id === "a1")!.revision,
          action: ReviewAction.cases.Accept.make({ mergedHead: "head", receipts: [] }),
        })
      );
      yield* dispatch(D, DEPENDENT);

      const read = text(
        yield* call(graphs, worker(DEPENDENT, "d1"), "logbook_read", { task: "A" })
      );

      expect(read).toContain("worker · note: Keyed by sequence.");
      expect(read).toContain("A Attempt 1 (a1) · Initial · accepted");

      // B does not depend on A, so B's worker may not read it.
      const refused = yield* call(graphs, worker(PEER, "b1"), "logbook_read", { task: "A" });

      expect(refused.isError).toBe(true);
      expect(refused.structuredContent?.findings?.map((f) => f.code)).toEqual(["E-AUTHORITY"]);
      expect(refused.structuredContent?.graph).toBeNull();

      // Nor does D's worker read B, which D does not depend on.
      const unrelated = yield* call(graphs, worker(DEPENDENT, "d1"), "logbook_read", { task: "B" });

      expect(unrelated.structuredContent?.findings?.map((f) => f.code)).toEqual(["E-AUTHORITY"]);
    })
  ));

test("a worker's note lands on its own Task; the Lead notes on any Task and reads every Task's", () =>
  run(
    Effect.gen(function* () {
      const { graphs } = yield* world;

      yield* call(graphs, worker(PEER, "b1"), "logbook_note", { text: "B keeps the old schema." });
      yield* call(graphs, lead, "logbook_note", { task: "A", text: "A owns the cursor." });

      const own = text(yield* call(graphs, worker(PEER, "b1"), "logbook_read", { task: "B" }));

      expect(own).toContain("B keeps the old schema.");
      expect(own).not.toContain("A owns the cursor.");

      const every = text(yield* call(graphs, lead, "logbook_read", {}));

      expect(every).toContain("Logbook · every Task");
      expect(every).toContain("lead · note: A owns the cursor.");
      expect(every).toContain("worker · note: B keeps the old schema.");

      // Only the Lead and the user read every Task's Logbook at once.
      const all = yield* call(graphs, worker(PEER, "b1"), "logbook_read", {});

      expect(all.structuredContent?.findings?.map((f) => f.code)).toEqual(["E-AUTHORITY"]);
    })
  ));

test("a read from the cursor it returned shows only what came after", () =>
  run(
    Effect.gen(function* () {
      const { graphs } = yield* world;
      const a = worker(WORKER, "a1");
      const first = text(yield* call(graphs, a, "logbook_read", { task: "A" }));
      const cursor = Number(/cursor (\d+)/.exec(first)![1]);

      yield* call(graphs, a, "logbook_note", { text: "Later." });

      const next = text(yield* call(graphs, a, "logbook_read", { task: "A", since: cursor }));

      expect(next).toContain("Entries (1):");
      expect(next).toContain("note: Later.");
      expect(next).not.toContain("brief ·");
    })
  ));

test("a refused note carries its finding and no graph, whether the command, the tool or the input refused it", () =>
  run(
    Effect.gen(function* () {
      const { graphs, send } = yield* world;

      yield* send(
        { kind: "session", sessionId: LEAD },
        C.Review.make({
          constellationId: CID,
          attemptId: AttemptId.make("b1"),
          revision: (yield* graphs.status(
            { kind: "user" },
            CID,
            true
          )).constellation!.attempts.find((x) => x.id === "b1")!.revision,
          action: ReviewAction.cases.Stop.make({ reason: "Not needed." }),
        })
      );

      const refusals = [
        // B's Attempt was stopped, so its worker no longer writes B's Logbook.
        [yield* call(graphs, worker(PEER, "b1"), "logbook_note", { text: "Late." }), "E-AUTHORITY"],
        [
          yield* call(graphs, lead, "logbook_note", { task: "Z", text: "No such Task." }),
          "E-TASK-UNKNOWN",
        ],
        [yield* call(graphs, lead, "logbook_note", { task: "A", text: "" }), "E-INPUT"],
        [yield* call(graphs, lead, "logbook_read", { task: "Z" }), "E-TASK-UNKNOWN"],
      ] as const;

      for (const [result, code] of refusals) {
        expect(result.isError).toBe(true);
        expect(result.structuredContent?.findings?.map((f) => f.code)).toEqual([code]);
        expect(result.structuredContent?.graph).toBeNull();
        expect(result.structuredContent?.revision).toBe(0);
      }
    })
  ));
