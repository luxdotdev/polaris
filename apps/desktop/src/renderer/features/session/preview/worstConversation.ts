/**
 * The conversation's break-UI scenes (ENG-499): `worst-turns` is a 256-character title on a long
 * branch, an unknown model and effort, 99% context, every notice, huge receipts and output, and
 * 24 running Subagents; `worst-context-*` are the context card's extremes, one per permission mode.
 */
import {
  ApprovalRequest,
  ContextCategory,
  ContextEntry,
  ContextSkills,
  ContextUsage,
  HostId,
  McpServerUsage,
  MemoryFile,
  MessageUsage,
  type PermissionMode,
  RequestId,
  Sequence,
  type SessionId,
  TurnItem,
  TurnId,
  Worktree,
  WorktreeId,
} from "@polaris/protocol";
import type { ConnectionState } from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { modelFromSnapshot } from "../../../store/hostModel.ts";
import type { SessionModel, SubagentView } from "../../../store/sessionModel.ts";
import { type AppState, initialState, sessionKey } from "../../../store/store.ts";
import { queuedOutgoing, type Outgoing } from "../model/outbox.ts";
import type { StagedAttachment } from "../state.ts";
import { agentCall, ago, model, session, subagentOf, turn, view, workspace } from "./fixtures.ts";

const I = TurnItem.cases;

export const WORST_CONVERSATION_SCENES = [
  "worst-turns",
  "worst-context-zero",
  "worst-context-unknown",
  "worst-context-huge",
  "worst-supervised",
] as const;

export type WorstConversationScene = (typeof WORST_CONVERSATION_SCENES)[number];

const LOCAL = "local";

const BRANCH =
  "aleksandra/eng-4821-investigate-why-the-daemons-event-store-replays-every-turn-twice-after-a-crash-during-compaction";

const TITLE =
  "Investigate why the Daemon’s event store replays every Turn twice after a crash during compaction on the Raspberry Pi 4, then write the failing trace to the spec’s Findings and open a follow-up for the Client’s resume, linked from ENG-4821 and ENG-4822";

const LONG_COMMAND =
  "POLARIS_PBT_RUNS=500 POLARIS_PBT_SEED=1849302 bun test apps/daemon/src/verification --rerun-each 50 --timeout 600000 2>&1 | tee /tmp/polaris-verification-traces/northwind-industries-holdings-customer-portal-monorepo.log";

/** A heredoc a Harness really sends: several lines, one of them long. */
const MULTILINE_COMMAND = `cat > /tmp/polaris-replay.sh <<'SH'
set -euo pipefail
for seed in 1849302 1849303 1849304; do
  POLARIS_PBT_SEED=$seed POLARIS_PBT_RUNS=500 bun test apps/daemon/src/verification --rerun-each 50 --timeout 600000 >> /tmp/polaris-verification-traces/run.log
done
SH
bash /tmp/polaris-replay.sh`;

const UNBROKEN =
  "/Users/aleksandra/code/northwind-industries-holdings-customer-portal-monorepo/node_modules/.pnpm/@northwind-industries+customer-portal-design-system@14.2.0-canary.20261028/node_modules/@northwind-industries/customer-portal-design-system/dist/esm/components/DataGrid/VirtualizedRows/useMeasuredRowHeights.js";

/** 20,000 lines of test output, one of them a 4 kB minified line. */
const HUGE_OUTPUT = Array.from({ length: 20_000 }, (_, i) =>
  i === 7
    ? `error: ${"Expected the fold to be idempotent;".repeat(120)}`
    : `(pass) store › replay › Turn ${i + 1} folds once after a crash at offset ${i * 4096} [${(i % 97) + 0.4}ms]`
).join("\n");

const WORKTREE = new Worktree({
  id: WorktreeId.make("wt-worst"),
  workspaceId: workspace.id,
  path: `${workspace.path}.worktrees/eng-4821`,
  branch: BRANCH,
  head: "9f8e7d6c5b4a",
  createdBySessionId: null,
  isMain: false,
});

const category = (name: string, kind: ContextCategory["kind"], tokens: number) =>
  new ContextCategory({ name, kind, tokens });

/** A 1M window at 99%, with 48 MCP servers and every category huge. */
const hugeContext = () =>
  new ContextUsage({
    usedTokens: 990_412,
    windowTokens: 1_000_000,
    categories: [
      category("System prompt", "used", 4_400),
      category("System tools", "used", 24_000),
      category("MCP tools", "used", 312_000),
      category("MCP server instructions", "used", 48_000),
      category("Custom agents", "used", 12_400),
      category("Skills", "used", 38_000),
      category("Memory files", "used", 96_000),
      category("Messages", "used", 455_612),
      category("Free space", "free", 9_588),
      category("Autocompact buffer", "buffer", 0),
    ],
    memoryFiles: Array.from(
      { length: 30 },
      (_, i) =>
        new MemoryFile({
          path: `${workspace.path}/packages/northwind-customer-portal-module-${i + 1}/AGENTS.md`,
          source: i === 0 ? "User" : "Project",
          tokens: 3_200,
        })
    ),
    categoriesTotal: 990_412,
    autoCompact: false,
    mcpServers: Array.from(
      { length: 48 },
      (_, i) =>
        new McpServerUsage({
          name: i === 0 ? "northwind-industries-holdings-internal-knowledge-base" : `server-${i}`,
          tools: 212 - i,
          loadedTools: 212 - i,
          tokens: 6_500,
          deferredTokens: 0,
        })
    ),
    skills: new ContextSkills({
      total: 1_284,
      included: 1_284,
      tokens: 38_000,
      top: [
        new ContextEntry({
          name: "northwind-customer-portal-accessibility-review-checklist",
          source: "projectSettings",
          tokens: 4_200,
        }),
        new ContextEntry({ name: "a", source: "userSettings", tokens: 1 }),
      ],
    }),
    agents: [new ContextEntry({ name: "Explore", source: "built-in", tokens: 12_400 })],
    messages: new MessageUsage({
      toolCalls: 120_000,
      toolResults: 290_000,
      replies: 30_000,
      userMessages: 12_000,
      attachments: 3_612,
      other: 0,
    }),
  });

const CONTEXTS: Readonly<Record<WorstConversationScene, ContextUsage | null>> = {
  "worst-turns": hugeContext(),
  "worst-context-huge": hugeContext(),
  // A fresh session: nothing counted yet, no breakdown.
  "worst-context-zero": new ContextUsage({ usedTokens: 0, windowTokens: 200_000 }),
  // A Harness that reports tokens but not its window.
  "worst-context-unknown": new ContextUsage({ usedTokens: 48_213, windowTokens: null }),
  "worst-supervised": null,
};

const MODES: Readonly<Record<WorstConversationScene, PermissionMode>> = {
  "worst-turns": "full-access",
  "worst-context-huge": "auto",
  "worst-context-zero": "plan",
  "worst-context-unknown": "auto-edits",
  "worst-supervised": "supervised",
};

const SWARM_TITLES = [
  "Find every place the renderer folds Subagent events and report which of them drop the final text",
  "a",
];

/** 24 Subagents, all still working, with long and short titles. */
const swarm = (s: SessionId, t: TurnId): ReadonlyArray<SubagentView> =>
  Array.from({ length: 24 }, (_, i) =>
    subagentOf(
      s,
      t,
      `toolu_${i === 0 ? "explore" : "agent"}_${i}`,
      SWARM_TITLES[i] ?? `Audit package ${i + 1}`,
      "working",
      [],
      [],
      { background: i % 3 === 0 }
    )
  );

const approvals = (s: SessionId, t: TurnId) => [
  new ApprovalRequest({
    id: RequestId.make("r-worst-command"),
    sessionId: s,
    turnId: t,
    kind: "command",
    title: LONG_COMMAND,
    detail: LONG_COMMAND,
    options: [],
    openedAt: ago(26 * 3600),
  }),
  new ApprovalRequest({
    id: RequestId.make("r-worst-files"),
    sessionId: s,
    turnId: t,
    kind: "file-change",
    title: "Change 1,284 files",
    detail: UNBROKEN,
    options: [],
    openedAt: ago(60),
  }),
  new ApprovalRequest({
    id: RequestId.make("r-worst-question"),
    sessionId: s,
    turnId: t,
    kind: "question",
    title:
      "Should the replay skip Turns whose checkpoint is missing, or stop and mark the session Failed so you can look at the store yourself before anything else is written?",
    detail: null,
    options: ["Skip them and keep going, writing each skipped Turn's id to the Findings", "Stop"],
    openedAt: ago(5),
  }),
];

const command = (id: string, cmd: string, output: string, exitCode: number | null) =>
  I.CommandExecution.make({
    id,
    command: cmd,
    cwd: WORKTREE.path,
    output,
    exitCode,
    status: exitCode === null ? "running" : "completed",
  });

/** The finished Turn: 1,284 files, 312 commands, 31 hours. */
const bigTurn = (s: SessionId) =>
  view(
    turn(s, 1, `Rename the event store’s folds across the monorepo. ${UNBROKEN}`, "completed", [], {
      startedAt: ago(40 * 3600),
      endedAt: ago(9 * 3600 - 41),
    }),
    [
      I.FileChange.make({
        id: "f1",
        changes: Array.from({ length: 1_284 }, (_, i) => ({
          path: `packages/module-${i}/src/fold.ts`,
          kind: "modify" as const,
        })),
        status: "completed",
      }),
      ...Array.from({ length: 312 }, (_, i) => command(`c1-${i}`, "bun test", "ok", 0)),
      I.AssistantMessage.make({
        id: "m1",
        text: `Done. ${UNBROKEN} was the last file. See https://linear.app/northwind/issue/ENG-4821/investigate-why-the-daemons-event-store-replays-every-turn-twice?comment=9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f`,
      }),
    ]
  );

const workingTurn = (s: SessionId) => {
  const t = turn(s, 2, TITLE, "working");
  const agents = swarm(s, t.id);

  return view(
    t,
    [
      command("c2", LONG_COMMAND, HUGE_OUTPUT, 1),
      I.ToolCall.make({
        id: "g2",
        name: "mcp__northwind-industries-holdings-internal-knowledge-base__search_architecture_decision_records",
        input: { query: UNBROKEN, limit: 1_000_000 },
        output: JSON.stringify(
          Array.from({ length: 400 }, (_, i) => ({ id: i, path: UNBROKEN, score: 0.1 + 0.2 }))
        ),
        status: "completed",
      }),
      ...agents.map((a) => agentCall(a.subagent.id, a.subagent.title, a.subagent.title, false)),
    ],
    [],
    agents
  );
};

/** 50 sessions, each waiting on one request: the Needs You inbox at its realistic worst. */
const waiting = () =>
  Array.from({ length: 50 }, (_, i) => {
    const s = session(`s-wait-${i}`, {
      title: i === 0 ? TITLE : `Waiting session ${i + 1}`,
      state: "needs-you",
      harness: i % 2 === 0 ? "claude" : "codex",
      updatedAt: ago(i * 3600),
    });

    return model({
      session: s,
      pendingApprovals: [
        new ApprovalRequest({
          id: RequestId.make(`r-wait-${i}`),
          sessionId: s.id,
          turnId: TurnId.make(`${s.id}-t1`),
          kind: i > 2 && i % 3 === 0 ? "question" : "command",
          title: i < 2 ? "Run a command" : `Run bun test packages/module-${i}`,
          detail: [LONG_COMMAND, MULTILINE_COMMAND][i] ?? `bun test packages/module-${i}`,
          options: [],
          openedAt: ago(i * 3600),
        }),
      ],
    });
  });

const shown = (scene: WorstConversationScene): SessionModel => {
  const turns = scene === "worst-turns";

  const s = session(`s-${scene}`, {
    title: turns ? TITLE : `Context: ${scene.replace("worst-", "")}`,
    worktreeId: WORKTREE.id,
    cwd: WORKTREE.path,
    state: turns ? "working" : "idle",
    // A model id and an effort this build's lists don't know.
    model: turns ? "claude-opus-5-5-20261101-preview[1m]" : "opus",
    effort: turns ? "ludicrous" : "high",
    permissionMode: MODES[scene],
    contextUsage: CONTEXTS[scene],
    turnCount: 1_284,
  });

  if (!turns) return model({ session: s, turns: [bigTurn(s.id)] });
  const working = workingTurn(s.id);

  return model({
    session: s,
    turns: [bigTurn(s.id), working],
    pendingApprovals: approvals(s.id, working.turn.id),
  });
};

/** Queued follow-ups for the notice strip. */
export const worstOutbox = (): ReadonlyArray<Outgoing<StagedAttachment>> => [
  queuedOutgoing(`Then rerun it with ${LONG_COMMAND}`, []),
  queuedOutgoing("And again", []),
];

const status = (state: ConnectionState, hostId: string) => ({
  state,
  failure:
    state === "needs-attention"
      ? { kind: "needs-attention" as const, reason: "Host key changed", detail: "" }
      : null,
  attempt: state === "connected" ? 0 : 14,
  since: Date.now() - 95_000,
  nextAttemptAt: state === "reconnecting" ? Date.now() + 12_000 : null,
  host: {
    hostId: HostId.make(hostId),
    hostname: hostId,
    platform: "linux-arm64" as const,
    daemonVersion: "0.0.0",
    homeDir: "/home/aleksandra",
    startedAt: "2026-09-29T00:00:00.000Z",
  },
  capabilities: [],
  epoch: 1,
  latencyMs: state === "connected" ? 2_840 : null,
  lastSeenAt: state === "connected" ? null : Date.now() - 412 * 86_400_000,
});

const remote = (key: string, label: string, state: ConnectionState): HostView => ({
  key,
  label,
  colour: null,
  alias: label,
  kind: "ssh",
  proofHarness: false,
  status: status(state, key),
});

/** Every Connection State, one long label. */
const remotes = (): ReadonlyArray<HostView> => [
  remote("builder", "build-runner-ubuntu-2404-arm64.tail9f3c2.ts.net", "reconnecting"),
  remote("pi", "pi", "offline"),
  remote("vm", "northwind-staging-vm-eu-central-1", "needs-attention"),
];

export const worstConversationState = (scene: WorstConversationScene, local: HostView) => {
  const main = shown(scene);
  const models = [main, ...waiting()];

  const empty = (key: string) => ({
    ...modelFromSnapshot({
      sequence: Sequence.make(1),
      workspaces: [],
      worktrees: [],
      sessions: [],
    }),
    synchronized: key === "builder",
  });

  const state: AppState = {
    ...initialState,
    hosts: [local, ...remotes()],
    hostModels: {
      [LOCAL]: {
        ...modelFromSnapshot({
          sequence: Sequence.make(90),
          workspaces: [workspace],
          worktrees: [WORKTREE],
          sessions: models.flatMap((m) =>
            m.session === null
              ? []
              : [
                  {
                    session: m.session,
                    pendingApprovals: m.pendingApprovals,
                    lastTurnPreview: null,
                    subagents: [],
                  },
                ]
          ),
        }),
        synchronized: true,
      },
      ...Object.fromEntries(remotes().map((h) => [h.key, empty(h.key)])),
    },
    sessions: Object.fromEntries(
      models.flatMap((m) => (m.session === null ? [] : [[sessionKey(LOCAL, m.session.id), m]]))
    ),
  };

  return { state, hostKey: LOCAL, shown: main.session?.id ?? null };
};

const MODEL_NAMES = [
  "Default (recommended for most tasks in this Workspace)",
  "claude-opus-5-5-20261101-preview[1m]",
];

/** 40 models: long names, unknown and no efforts, a description that runs on. */
export const worstModels = (harness: "claude" | "codex") =>
  Array.from({ length: 40 }, (_, i) => ({
    id: `${harness}-model-${i}`,
    name: MODEL_NAMES[i] ?? `Model ${i + 1}`,
    description:
      i === 0
        ? "Uses the account’s default; on Max this is Opus 5.5 with 1M context until the weekly limit, then Sonnet 5.5"
        : null,
    efforts:
      i === 0
        ? ["minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ludicrous"]
        : i % 2 === 0
          ? []
          : ["low", "high"],
    defaultEffort: i === 0 ? "ludicrous" : null,
    isDefault: i === 0,
  }));
