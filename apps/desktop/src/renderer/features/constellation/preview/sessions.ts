/** The Lead's and workers' Agent Sessions for previews, with the Lead's and B1's Turns open. */
import {
  AgentSession,
  ContextUsage,
  type SessionId,
  Turn,
  TurnId,
  TurnItem,
  type TurnStatus,
  Workspace,
  Worktree,
  WorktreeId,
} from "@polaris/protocol";
import type { SessionModel, TurnView } from "../../../store/sessionModel.ts";
import { LEAD, PREVIOUS_LEAD, WORKSPACE, worker } from "./graph.ts";

const I = TurnItem.cases;

const HOME = "/Users/lucas";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const workspace = new Workspace({
  id: WORKSPACE,
  path: `${HOME}/code/polaris`,
  name: "polaris",
  isGitRepo: true,
  worktreeRoot: `${HOME}/code/polaris.worktrees`,
  hidden: false,
  registeredAt: "2026-09-01T09:00:00.000Z",
});

export const worktree = new Worktree({
  id: WorktreeId.make("wt-main"),
  workspaceId: WORKSPACE,
  path: workspace.path,
  branch: "main",
  head: "8e41d07",
  createdBySessionId: null,
  isMain: true,
});

export const session = (id: SessionId, patch: Partial<AgentSession>) =>
  new AgentSession({
    id,
    workspaceId: WORKSPACE,
    harness: "codex",
    title: "",
    cwd: workspace.path,
    worktreeId: worktree.id,
    state: "working",
    permissionMode: "auto-edits",
    model: "gpt-6.1-sol",
    effort: "high",
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 1,
    contextUsage: null,
    lastError: null,
    createdAt: ago(60),
    updatedAt: ago(1),
    ...patch,
  });

const usage = (percent: number) =>
  new ContextUsage({ usedTokens: percent * 2000, windowTokens: 200_000 });

export const leadSession = session(LEAD, {
  harness: "claude",
  model: "opus",
  title: "Constellations v1 lead",
  turnCount: 14,
  contextUsage: usage(58),
  createdAt: ago(120),
});

const WORKERS: ReadonlyArray<readonly [string, string, AgentSession["state"], number]> = [
  ["A1", "Constellation events and stream", "idle", 30],
  ["A2", "Decider and projections", "idle", 40],
  ["B1", "Quint properties", "idle", 52],
  ["B2", "MCP tools", "working", 61],
  ["B3", "Tool eval", "working", 48],
  ["B4", "HTTP endpoint", "idle", 33],
  ["B5", "Trace validation", "idle", 71],
];

export const workerSessions = WORKERS.map(([id, title, state, percent]) =>
  session(worker(id), { title: `${id} · ${title}`, state, contextUsage: usage(percent) })
);

export const previousLead = session(PREVIOUS_LEAD, {
  harness: "claude",
  model: "opus",
  title: "Constellations v1 lead (previous)",
  state: "archived",
  contextUsage: usage(94),
});

const turn = (
  sessionId: SessionId,
  id: string,
  index: number,
  prompt: string,
  status: TurnStatus,
  minutes: number
) =>
  new Turn({
    id: TurnId.make(id),
    sessionId,
    index,
    prompt,
    attachments: [],
    model: null,
    effort: null,
    status,
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: ago(minutes),
    endedAt: status === "working" ? null : ago(minutes - 1),
  });

const view = (t: Turn, items: ReadonlyArray<TurnItem>): TurnView => ({
  turn: t,
  items,
  live: new Map(),
  subagents: [],
});

const statusOf = (exitCode: number | null) => {
  if (exitCode === null) return "running";

  return exitCode === 0 ? "completed" : "failed";
};

const command = (id: string, text: string, exitCode: number | null, output = "") =>
  I.CommandExecution.make({
    id,
    command: text,
    cwd: workspace.path,
    output,
    exitCode,
    status: statusOf(exitCode),
  });

export const leadModel = (digestTurn = "t-lead-digest"): SessionModel => ({
  // SAFETY: preview sequences only need to be numbers.
  sequence: 50 as SessionModel["sequence"],
  synchronized: true,
  session: leadSession,
  pendingApprovals: [],
  turns: [
    view(
      turn(
        LEAD,
        "t-lead-12",
        12,
        "Dispatch B and keep me posted on the bench lock.",
        "completed",
        60
      ),
      [
        I.AssistantMessage.make({
          id: "m12",
          text: "Dispatched B1–B5. B3 will wait on the bench lock that B2 holds.",
        }),
      ]
    ),
    view(turn(LEAD, digestTurn, 13, "Constellations v1 · 3 updates for the lead", "working", 3), [
      I.Reasoning.make({ id: "r13", text: "", startedAt: ago(3), endedAt: ago(3) }),
      I.AssistantMessage.make({
        id: "m13",
        text: "B1's trace check fails on the handover log, which is B5's Task. I'll review B1 against its head, then restart B5 fresh with the failing trace as its brief. The lease proposal is yours to decide.",
      }),
      command("c13a", "git log --oneline -1 3f9c2e1", 0, "3f9c2e1 Quint properties for ENG-236\n"),
      command("c13b", "bun run spec", 0, "8 properties checked\n"),
      command("c13c", "bun test apps/daemon/src/verification", null),
    ]),
  ],
});

export const B1_BRIEF_TURN = "t-b1-brief";

export const b1Model = (): SessionModel => ({
  // SAFETY: preview sequences only need to be numbers.
  sequence: 40 as SessionModel["sequence"],
  synchronized: true,
  session: workerSessions.find((s) => s.id === worker("B1")) ?? leadSession,
  pendingApprovals: [],
  turns: [
    view(turn(worker("B1"), B1_BRIEF_TURN, 0, "Polaris brief for B1", "completed", 40), [
      I.Reasoning.make({ id: "rb1", text: "", startedAt: ago(40), endedAt: ago(39) }),
      I.AssistantMessage.make({
        id: "mb1",
        text: "Seven of the eight properties hold and the simulator is clean. Trace validation fails on the handover log because nothing records handover yet; that's B5's Task. Claiming with that noted.",
      }),
      command("i-spec", "bun run spec", 0),
      command("i-tests", "bun test …/verification", 0),
      command("i-trace", "trace validation · handover.ndjson", 1),
    ]),
  ],
});
