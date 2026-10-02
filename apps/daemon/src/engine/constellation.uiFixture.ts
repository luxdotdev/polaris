/**
 * A real store for screenshots of the Constellation tab against the live Daemon: a Workspace,
 * a Lead and workers, and one graph in every state. Run between Daemons on a temporary home.
 *
 *   bun apps/daemon/src/engine/constellation.uiFixture.ts <home> <workspace path>
 */
import { join } from "node:path";
import {
  AgentSession,
  Attempt,
  AttemptCause,
  AttemptId,
  CheckReceipt,
  Claim,
  Constellation,
  ConstellationId,
  ConstellationSettings,
  DomainEvent,
  type HarnessKind,
  type SessionId,
  SessionId as Sid,
  Task,
  TaskId,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { loadHostInfo } from "../transport/hostInfo.ts";

const E = DomainEvent.cases;

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const session = (
  workspace: Workspace,
  id: string,
  title: string,
  harness: HarnessKind,
  model: string
) =>
  new AgentSession({
    id: Sid.make(id),
    workspaceId: workspace.id,
    harness,
    title,
    cwd: workspace.path,
    worktreeId: null,
    state: "idle",
    permissionMode: "auto-edits",
    model,
    effort: "high",
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: at(90),
    updatedAt: at(1),
  });

const task = (
  id: string,
  title: string,
  group: string,
  deps: ReadonlyArray<string> = [],
  kind: "task" | "gate" = "task"
) =>
  new Task({
    id: TaskId.make(id),
    title,
    kind,
    deps: deps.map((d) => TaskId.make(d)),
    area: [],
    brief: `Do ${title.toLowerCase()}.`,
    criteria: [],
    suggested: null,
    group,
    revision: 0,
    canceled: false,
  });

export const seedUiConstellation = Effect.fnUntraced(function* (home: string, path: string) {
  const store = yield* EventStore;
  const { hostId } = yield* loadHostInfo(home);

  const workspace = new Workspace({
    id: WorkspaceId.make("w-ui"),
    path,
    name: "polaris",
    isGitRepo: true,
    worktreeRoot: `${path}.worktrees`,
    hidden: false,
    registeredAt: at(120),
  });

  const lead = session(workspace, "s-ui-lead", "Constellations v1 lead", "claude", "opus");

  const workers = {
    A1: session(workspace, "s-ui-a1", "A1 · Events", "codex", "gpt-6.1-sol"),
    A2: session(workspace, "s-ui-a2", "A2 · Decider", "codex", "gpt-6.1-sol"),
    B1: session(workspace, "s-ui-b1", "B1 · Quint properties", "codex", "gpt-6.1-sol"),
    B2: session(workspace, "s-ui-b2", "B2 · MCP tools", "codex", "gpt-6.1-sol"),
    B3: session(workspace, "s-ui-b3", "B3 · Tab", "claude", "opus"),
  };

  const id = ConstellationId.make("c-ui");
  const A = "A · Events and decider";
  const B = "B · Spec and tools";

  const tasks = [
    task("A1", "Constellation events and stream", A),
    task("A2", "Decider and projections", A, ["A1"]),
    task("G1", "Engine merged to main", A, ["A1", "A2"], "gate"),
    task("B1", "Quint properties", B, ["G1"]),
    task("B2", "Lead and worker MCP tools", B, ["G1"]),
    task("B3", "Constellation tab", B, ["G1"]),
    task("B4", "Streamable-HTTP endpoint", B, ["G1"]),
    task("G2", "Spec and tools merged", B, ["B1", "B2", "B3", "B4"], "gate"),
  ];

  const attempt = (taskId: string, sessionId: SessionId, minutes: number) =>
    new Attempt({
      id: AttemptId.make(`${taskId}-1`),
      taskId: TaskId.make(taskId),
      revision: 0,
      cause: AttemptCause.cases.Initial.make({}),
      by: lead.id,
      sessionId,
      hostId,
      worktree: `${path}.worktrees/c-ui/${taskId}`,
      branch: `polaris/c-ui/${taskId}`,
      base: "base",
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
      startedAt: at(minutes),
      endedAt: null,
    });

  const claim = (taskId: string, ok: boolean) =>
    new Claim({
      branch: `polaris/c-ui/${taskId}`,
      head: "3f9c2e1a77",
      commits: ["3f9c2e1"],
      receipts: [
        CheckReceipt.cases.Reported.make({
          label: "spec",
          text: "bun run spec",
          command: "bun run spec",
          exitCode: 0,
        }),
        CheckReceipt.cases.Reported.make({
          label: "trace",
          text: "trace validation",
          command: null,
          exitCode: ok ? 0 : 1,
        }),
      ],
      notDone: ok ? [] : ["Trace for handover"],
      followups: [],
      questions: [],
      outsideArea: [],
      decisions: [],
      summary: "Done.",
    });

  let revision = 0;
  const graph = { constellationId: id };
  const next = () => ++revision;

  const events: Array<DomainEvent> = [
    E.WorkspaceRegistered.make({ workspace }),
    E.SessionCreated.make({ session: lead }),
    ...Object.values(workers).map((s) => E.SessionCreated.make({ session: s })),
    E.ConstellationStarted.make({
      ...graph,
      revision: 0,
      constellation: new Constellation({
        id,
        workspaceId: workspace.id,
        hostId,
        leadSessionId: lead.id,
        name: "Constellations v1",
        state: "planning",
        revision: 0,
        settings: new ConstellationSettings({}),
        tasks: [],
        attempts: [],
        pendingNotifications: [],
        createdAt: at(80),
        updatedAt: at(80),
      }),
    }),
    ...tasks.map((t) => E.TaskDeclared.make({ ...graph, revision: next(), task: t })),
    E.ConstellationStateChanged.make({ ...graph, revision: next(), state: "running" }),
  ];

  const accept = (taskId: string, sessionId: SessionId, minutes: number) => {
    const a = attempt(taskId, sessionId, minutes);

    events.push(
      E.AttemptStarted.make({ ...graph, revision: next(), attempt: a }),
      E.AttemptClaimed.make({
        ...graph,
        revision: next(),
        attemptId: a.id,
        attemptRevision: 1,
        claim: claim(taskId, true),
      }),
      E.AttemptAccepted.make({
        ...graph,
        revision: next(),
        attemptId: a.id,
        attemptRevision: 2,
        mergedHead: "3f9c2e1a77",
        receipts: [
          CheckReceipt.cases.Reported.make({
            label: "test",
            text: "bun run test",
            command: "bun run test",
            exitCode: 0,
          }),
        ],
        evidence: "reported",
      })
    );
  };

  accept("A1", workers.A1.id, 80);
  accept("A2", workers.A2.id, 70);
  accept("G1", lead.id, 60);

  const b1 = attempt("B1", workers.B1.id, 41);

  events.push(
    E.AttemptStarted.make({ ...graph, revision: next(), attempt: b1 }),
    E.AttemptClaimed.make({
      ...graph,
      revision: next(),
      attemptId: b1.id,
      attemptRevision: 1,
      claim: claim("B1", false),
    }),
    E.AttemptStarted.make({
      ...graph,
      revision: next(),
      attempt: attempt("B2", workers.B2.id, 31),
    }),
    E.AttemptStarted.make({
      ...graph,
      revision: next(),
      attempt: attempt("B3", workers.B3.id, 18),
    })
  );

  yield* store.commit({ commandId: null, decide: () => Effect.succeed(events) });

  return events.length;
});

if (import.meta.main) {
  const [home, path] = process.argv.slice(2);

  if (home === undefined || path === undefined) throw new Error("supply <home> <workspace path>");

  console.log(
    await Effect.runPromise(
      seedUiConstellation(home, path).pipe(
        Effect.provide(EventStore.layerSqlite(join(home, "state.sqlite")))
      )
    )
  );
}
