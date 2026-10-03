import { basename } from "node:path";
import {
  AgentSession,
  Attempt,
  AttemptCause,
  AttemptId,
  CommandId,
  DomainEvent,
  SessionId,
  Workspace,
  type HostId,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { decideSession } from "../../engine/session.ts";
import { selectWorker } from "../../harness/constellation/index.ts";
import { EventStore } from "../../store/EventStore.ts";
import { HarnessRegistry } from "../../services.ts";
import { finding, refusal } from "../decision.ts";
import { WorktreeSetupService } from "../setup/index.ts";
import type { WorkerPreparation } from "../transfers/prepareWorkers.ts";

/** Provision only the Session; the committed Attempt's acquired startup hook owns its first Turn. */
export const prepareSession = Effect.fn("Constellation.prepareSession")(function* (
  input: WorkerPreparation,
  hostId: HostId
) {
  const store = yield* EventStore;
  const at = new Date().toISOString();
  const model = yield* store.model;
  const lead = model.sessions.get(input.graph.leadSessionId)?.session;

  const sessionId =
    input.task.kind === "gate"
      ? input.graph.leadSessionId
      : Predicate.isTagged(input.placement, "Existing")
        ? input.placement.sessionId
        : SessionId.make(`${input.key}:worker`);

  const existing = model.sessions.get(sessionId)?.session;

  const selection = selectWorker(
    Predicate.isTagged(input.placement, "New") ? input.placement.selection : null,
    input.task.suggested,
    input.task.group === "ui" || input.task.group === "design"
      ? (input.graph.settings.ui ?? input.graph.settings.defaults)
      : (input.graph.settings.backend ?? input.graph.settings.defaults),
    existing ?? lead ?? { harness: "codex", model: null, effort: null }
  );

  if (existing?.state === "archived")
    return yield* refusal(model.constellations.get(input.graph.id), [
      finding("E-SESSION", "The selected Session is archived", "Choose an active Session."),
    ]);

  const session =
    existing ??
    new AgentSession({
      id: sessionId,
      workspaceId: input.graph.workspaceId,
      ...selection,
      cwd: input.worktree.worktree,
      worktreeId: null,
      title: `${input.task.id} · ${input.task.title}`,
      state: "dormant",
      permissionMode: lead?.permissionMode ?? "supervised",
      parentSessionId: null,
      forkedFromTurnId: null,
      harnessCursor: null,
      turnCount: 0,
      contextUsage: null,
      lastError: null,
      createdAt: at,
      updatedAt: at,
    });

  if (session.permissionMode === "auto") {
    const registry = yield* HarnessRegistry;

    const driver = yield* registry
      .get(session.harness)
      .pipe(
        Effect.mapError((error) =>
          refusal(model.constellations.get(input.graph.id), [
            finding("E-HARNESS", error.message, "Choose an available harness and retry dispatch."),
          ])
        )
      );

    yield* (driver.validatePermissionMode?.(session) ?? Effect.void).pipe(
      Effect.mapError((error) =>
        refusal(model.constellations.get(input.graph.id), [
          finding(
            "E-HARNESS-PERMISSIONS",
            error.message,
            "Choose a model that supports auto, or change the lead's permission mode."
          ),
        ])
      )
    );
  }

  if (existing === undefined)
    yield* store
      .commit({
        commandId: CommandId.make(`${input.key}:session`),
        decide: (current) => {
          if (current.sessions.has(sessionId)) return Effect.succeed([]);

          const workspace = current.workspaces.has(input.graph.workspaceId)
            ? []
            : [
                DomainEvent.cases.WorkspaceRegistered.make({
                  workspace: new Workspace({
                    id: input.graph.workspaceId,
                    path: input.worktree.repoPath,
                    name: basename(input.worktree.repoPath),
                    isGitRepo: true,
                    worktreeRoot: `${input.worktree.repoPath}.worktrees`,
                    hidden: false,
                    registeredAt: at,
                  }),
                }),
              ];

          return Effect.succeed([
            ...workspace,
            ...decideSession(undefined, { type: "session.fork", session }).events,
          ]);
        },
      })
      .pipe(Effect.orDie);

  const reusesWorktree =
    existing !== undefined &&
    input.previous?.sessionId === sessionId &&
    input.previous.worktree === input.worktree.worktree &&
    existing.cwd === input.worktree.worktree;

  if (input.task.kind !== "gate" && !reusesWorktree) {
    const setup = yield* (yield* WorktreeSetupService)
      .run(
        sessionId,
        input.key,
        input.worktree.worktree,
        input.worktreeSetup ?? null,
        input.graph.id,
        input.task.id
      )
      .pipe(
        Effect.mapError((error) =>
          refusal(model.constellations.get(input.graph.id), [
            finding(
              "E-SESSION-BUSY",
              error.reason,
              "Wait for the selected Session’s Turn to end before setting up its worktree, then retry."
            ),
          ])
        )
      );

    if (setup?.status === "failed")
      return yield* refusal(model.constellations.get(input.graph.id), [
        finding(
          "E-SETUP",
          `Worktree setup failed: ${setup.command}`,
          `Open ${sessionId}, fix setup and dispatch again.`
        ),
      ]);
  }

  return new Attempt({
    id: AttemptId.make(`${input.key}:attempt`),
    taskId: input.task.id,
    revision: 0,
    cause:
      input.previous === null
        ? AttemptCause.cases.Initial.make({})
        : AttemptCause.cases.Followup.make({ ref: input.previous.id }),
    by: input.graph.leadSessionId,
    sessionId,
    hostId,
    worktree: input.worktree.worktree,
    branch: input.worktree.branch,
    base: input.worktree.base,
    state: "working",
    claim: null,
    mergedHead: null,
    receipts: [],
    evidence: null,
    claimedAt: null,
    approvedByUserAt: null,
    handedUpAt: null,
    handedUpReason: null,
    nudgedAt: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  });
});
