/** The polaris Workspace of Paper E1 on fixtures: folders, git status and two agents. */
import {
  AgentSession,
  ApprovalRequest,
  RequestId,
  type SessionId,
  SessionId as SessionIds,
  Turn,
  TurnId,
  TurnItem,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import type { SessionModel } from "../../../../store/sessionModel.ts";

export const HOME = "/Users/lucas";

export const ROOT = `${HOME}/code/polaris`;

export const WORKSPACE = WorkspaceId.make("ws-polaris");

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const workspace = new Workspace({
  id: WORKSPACE,
  path: ROOT,
  name: "polaris",
  isGitRepo: true,
  worktreeRoot: `${ROOT}.worktrees`,
  hidden: false,
  registeredAt: "2026-09-01T09:00:00.000Z",
});

/** Folder → its entries; a trailing "/" marks a folder. */
const TREE = new Map<string, ReadonlyArray<string>>([
  ["", ["daemon/", "desktop/", "design/", "CONTEXT.md", "DESIGN.md", "package.json"]],
  ["daemon", ["src/"]],
  ["daemon/src", ["hosts/", "sessions/", "log.ts"]],
  ["daemon/src/hosts", ["reconnect.ts", "transport.ts"]],
  ["daemon/src/sessions", ["engine.ts", "store.ts"]],
  ["desktop", ["src/"]],
  ["desktop/src", ["orchestrator/"]],
  ["desktop/src/orchestrator", ["session-row.tsx", "working-strip.tsx", "session-row.test.tsx"]],
  ["design", ["tokens.json"]],
]);

/** A Review Checkout outside the Workspace's folder, for the "checkout" scene. */
export const CHECKOUT = `${ROOT}.worktrees/.review/pr-42`;

const CHECKOUT_TREE: ReadonlyArray<string> = ["src/", "README.md", "package.json"];

export const listing = (dir: string) => {
  const names =
    dir === CHECKOUT
      ? CHECKOUT_TREE
      : dir.startsWith(`${ROOT}/`) || dir === ROOT
        ? TREE.get(dir.slice(ROOT.length + 1))
        : undefined;

  return names?.map((name) => {
    const folder = name.endsWith("/");
    const clean = folder ? name.slice(0, -1) : name;

    return {
      name: clean,
      path: `${dir}/${clean}`,
      kind: folder ? ("directory" as const) : ("file" as const),
      size: 0,
      modifiedAt: "2026-10-02T09:00:00.000Z",
    };
  });
};

export const STATUS = {
  branch: "main",
  head: "8e41d07c",
  ahead: 2,
  behind: 0,
  entries: [
    { path: "daemon/src/hosts/reconnect.ts", origPath: null, index: ".", worktree: "M" },
    { path: "daemon/src/hosts/retry-policy.ts", origPath: null, index: "D", worktree: "." },
    { path: "desktop/src/orchestrator/session-row.tsx", origPath: null, index: ".", worktree: "M" },
    {
      path: "desktop/src/orchestrator/working-strip.tsx",
      origPath: null,
      index: "A",
      worktree: ".",
    },
    {
      path: "desktop/src/orchestrator/session-row.test.tsx",
      origPath: null,
      index: "?",
      worktree: "?",
    },
    { path: "CONTEXT.md", origPath: null, index: ".", worktree: "M" },
  ],
};

const session = (id: SessionId, patch: Partial<AgentSession>) =>
  new AgentSession({
    id,
    workspaceId: WORKSPACE,
    harness: "claude",
    title: "",
    cwd: ROOT,
    worktreeId: null,
    state: "working",
    permissionMode: "auto-edits",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 3,
    contextUsage: null,
    lastError: null,
    createdAt: ago(60),
    updatedAt: ago(1),
    ...patch,
  });

export const SPIKE = SessionIds.make("s-spike");

export const PLANNING = SessionIds.make("s-planning");

export const spike = session(SPIKE, {
  harness: "codex",
  title: "Spike GPUI review screen",
  state: "needs-you",
  createdAt: ago(42),
});

export const planning = session(PLANNING, {
  title: "Polaris planning",
  createdAt: ago(300),
});

export const spikeApproval = new ApprovalRequest({
  id: RequestId.make("r-cargo"),
  sessionId: SPIKE,
  turnId: TurnId.make("t-spike"),
  kind: "command",
  title: "Run cargo build",
  detail: null,
  options: [],
  openedAt: ago(2),
});

const turn = (id: string, sessionId: SessionId) =>
  new Turn({
    id: TurnId.make(id),
    sessionId,
    index: 2,
    prompt: "",
    attachments: [],
    status: "working",
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: ago(5),
    endedAt: null,
    model: null,
    effort: null,
    feedback: null,
  });

const change = (id: string, path: string, status: "running" | "completed") =>
  TurnItem.cases.FileChange.make({ id, changes: [{ path, kind: "modify" }], status });

const model = (
  sessionData: AgentSession,
  turnId: string,
  items: ReadonlyArray<TurnItem>,
  live: ReadonlyArray<TurnItem>
): SessionModel => ({
  // SAFETY: sequences start at 1; a preview's model is never compared against a live feed.
  sequence: 9 as SessionModel["sequence"],
  synchronized: true,
  session: sessionData,
  pendingApprovals: [],
  turns: [
    {
      turn: turn(turnId, sessionData.id),
      items,
      live: new Map(live.map((item) => [item.id, { item, text: "", output: "" }])),
      subagents: [],
    },
  ],
});

export const planningModel = model(
  planning,
  "t-planning",
  [change("c1", "desktop/src/orchestrator/session-row.tsx", "completed")],
  [change("c2", `${ROOT}/desktop/src/orchestrator/working-strip.tsx`, "running")]
);

export const spikeModel = model(
  spike,
  "t-spike",
  [change("c3", "daemon/src/sessions/engine.ts", "completed")],
  []
);
