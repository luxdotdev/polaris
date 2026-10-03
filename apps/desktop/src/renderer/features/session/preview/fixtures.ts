/**
 * Fixture sessions for the preview: artboard 5's "Polaris planning" mid-Turn,
 * an approval, a question and an interrupted Turn, with realistic prose,
 * Models and a diff, so screenshots compare against Paper on content too.
 */
import {
  AgentSession,
  Subagent,
  SubagentId,
  Attachment,
  AttachmentId,
  ContextUsage,
  ApprovalRequest,
  RequestId,
  Sequence,
  SessionId,
  Turn,
  TurnId,
  TurnItem,
  type TurnStatus,
  Workspace,
  WorkspaceId,
  Worktree,
  WorktreeId,
} from "@polaris/protocol";
import type {
  LiveItem,
  SessionModel,
  SubagentView,
  TurnView,
} from "../../../store/sessionModel.ts";
import { MISSED_STEER, type Outgoing, queuedOutgoing, steerOutgoing } from "../model/outbox.ts";
import type { StagedAttachment } from "../state.ts";

const I = TurnItem.cases;

const HOME = "/Users/lucas";

export const workspaceId = WorkspaceId.make("w-polaris");

export const workspace = new Workspace({
  id: workspaceId,
  path: `${HOME}/code/polaris`,
  name: "polaris",
  isGitRepo: true,
  worktreeRoot: `${HOME}/code/polaris.worktrees`,
  hidden: false,
  registeredAt: "2026-09-01T09:00:00.000Z",
});

export const worktree = new Worktree({
  id: WorktreeId.make("wt-main"),
  workspaceId,
  path: workspace.path,
  branch: "main",
  head: "4f2c1a9",
  createdBySessionId: null,
  isMain: true,
});

export const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

export const turn = (
  sessionId: SessionId,
  index: number,
  prompt: string,
  status: TurnStatus,
  attachments: ReadonlyArray<Attachment> = [],
  /** Fields a scene sets itself (a Harness-started Turn's trigger and times). */
  patch: Partial<Pick<Turn, "trigger" | "startedAt" | "endedAt">> = {}
) =>
  new Turn({
    id: TurnId.make(`${sessionId}-t${index}`),
    sessionId,
    index,
    prompt,
    attachments,
    model: "opus",
    effort: "high",
    status,
    checkpointBefore: `refs/polaris/checkpoints/${sessionId}/${index}/before`,
    checkpointAfter:
      status === "working" ? null : `refs/polaris/checkpoints/${sessionId}/${index}/after`,
    startedAt: status === "working" ? ago(72) : ago(3600),
    endedAt: status === "working" ? null : ago(3500),
    ...patch,
  });

export const session = (id: string, patch: Partial<AgentSession>) =>
  new AgentSession({
    id: SessionId.make(id),
    workspaceId,
    harness: "claude",
    title: "Polaris planning",
    cwd: workspace.path,
    worktreeId: worktree.id,
    state: "working",
    permissionMode: "auto-edits",
    model: "opus",
    effort: "high",
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 24,
    contextUsage: null,
    lastError: null,
    createdAt: ago(18_000),
    updatedAt: ago(10),
    ...patch,
  });

export const view = (
  t: Turn,
  items: ReadonlyArray<TurnItem>,
  live: ReadonlyArray<readonly [string, LiveItem]> = [],
  subagents: ReadonlyArray<SubagentView> = []
): TurnView => ({ turn: t, items, live: new Map(live), subagents });

const earlierTurn = (sessionId: SessionId) =>
  view(turn(sessionId, 22, "Record the Review decision and close ENG-185", "completed"), [
    I.AssistantMessage.make({
      id: "m22",
      text: "Recorded the Review decision, closed ENG-185 and linked it from ENG-167.",
    }),
    I.FileChange.make({
      id: "f22",
      changes: [{ path: "CONTEXT.md", kind: "modify" }],
      status: "completed",
    }),
  ]);

const PLAN = I.Plan.make({
  id: "p24",
  steps: [
    { text: "Moved ENG-177 to In Progress", status: "completed", detail: null },
    { text: "Read the Orchestrator notes and mock data", status: "completed", detail: null },
    { text: "Write index.html", status: "in-progress", detail: "Writing index.html" },
    { text: "Publish the prototype as an artifact", status: "pending", detail: null },
  ],
  explanation: null,
});

export const model = (patch: Partial<SessionModel>): SessionModel => ({
  sequence: Sequence.make(90),
  synchronized: true,
  session: null,
  turns: [],
  pendingApprovals: [],
  ...patch,
});

/** Artboard 5: Working on turn 24, the plan live, turn 23 folded. */
export const planning = (): SessionModel => {
  const s = session("s-planning", {
    contextUsage: new ContextUsage({ usedTokens: 84_000, windowTokens: 200_000 }),
  });

  const thinking = I.Reasoning.make({ id: "r25", text: "", startedAt: ago(4), endedAt: null });

  return model({
    session: s,
    turns: [
      earlierTurn(s.id),
      view(
        turn(
          s.id,
          23,
          "Let's go on to 177. Prototype the Orchestrator layouts so I can compare them side by side.",
          "working"
        ),
        [
          I.Reasoning.make({
            id: "r24",
            text: "Four layouts from one mock data set; arrow keys flip between them.",
            startedAt: ago(84),
            endedAt: ago(72),
          }),
          I.AssistantMessage.make({
            id: "m24",
            text: "I'll build four structurally different variants from the same mock data, so you can flip between them with ← and →.",
          }),
          I.ToolCall.make({
            id: "t24",
            name: "read_file",
            input: { path: "prototypes/orchestrator-layout/mock.ts" },
            output: null,
            status: "completed",
          }),
        ],
        [
          ["p24", { item: PLAN, text: "", output: "" }],
          ["r25", { item: thinking, text: "Checking how the mock data is shaped.", output: "" }],
        ]
      ),
    ],
  });
};

/** Artboard 1's request, inline: Needs You on a command. */
export const approval = (): SessionModel => {
  const s = session("s-spike", {
    title: "Spike GPUI review screen",
    harness: "codex",
    state: "needs-you",
    model: "gpt-6.1-sol",
    effort: "high",
    contextUsage: new ContextUsage({ usedTokens: 236_000, windowTokens: 258_000 }),
  });

  const t = turn(
    s.id,
    3,
    "Build the review screen in GPUI and compare it with the Electron spike",
    "working"
  );

  return model({
    session: s,
    turns: [
      view(t, [
        I.AssistantMessage.make({
          id: "m1",
          text: "The layout compiles. I need a release build to measure the frame times against the Electron spike.",
        }),
        I.CommandExecution.make({
          id: "c1",
          command: "cargo check",
          cwd: s.cwd,
          output:
            "    Checking polaris-review v0.1.0\n    Finished dev [unoptimized] target(s) in 4.21s\n",
          exitCode: 0,
          status: "completed",
        }),
      ]),
    ],
    pendingApprovals: [
      new ApprovalRequest({
        id: RequestId.make("r-build"),
        sessionId: s.id,
        turnId: t.id,
        kind: "command",
        title: "Run cargo build --release",
        detail: "cargo build --release -p polaris-review",
        options: [],
        openedAt: ago(42 * 60),
      }),
    ],
  });
};

/** A question with numbered answers. */
export const question = (): SessionModel => {
  const s = session("s-question", { title: "Session rows v2", state: "needs-you" });
  const t = turn(s.id, 1, "Tighten the session rows for Compact density", "working");

  return model({
    session: s,
    turns: [
      view(t, [
        I.AssistantMessage.make({
          id: "m1",
          text: "Compact drops the second line. Before I change the tile size, one question.",
        }),
      ]),
    ],
    pendingApprovals: [
      new ApprovalRequest({
        id: RequestId.make("r-q"),
        sessionId: s.id,
        turnId: t.id,
        kind: "question",
        title: "Should Compact keep the Harness tile at 20px?",
        detail: "DESIGN.md sets 20px; the Paper artboard shows 18px.",
        options: ["Keep 20px, as DESIGN.md says", "Use 18px, as the artboard shows"],
        openedAt: ago(120),
      }),
    ],
  });
};

/** Needs You after a Daemon restart: the Turn was interrupted; Continue is offered. */
export const interrupted = (): SessionModel => {
  const s = session("s-interrupted", {
    title: "Fix eligibility form validation",
    state: "needs-you",
  });

  return model({
    session: s,
    turns: [
      view(turn(s.id, 7, "Validate the date of birth field before submit", "interrupted"), [
        I.CommandExecution.make({
          id: "c1",
          command: "bun test src/forms",
          cwd: s.cwd,
          output: Array.from({ length: 14 }, (_, n) => `  ✓ eligibility › case ${n + 1}`).join(
            "\n"
          ),
          exitCode: 1,
          status: "failed",
        }),
      ]),
    ],
  });
};

/**
 * A Failed Turn whose error is one long unbroken token (an API body nothing
 * unwrapped): the error row must wrap it, never scroll sideways.
 */
export const failed = (): SessionModel => {
  const raw =
    '{"type":"error","error":{"message":"model_gpt-6-luna_is_not_supported_when_using_the_responses_api_with_this_account",' +
    '"type":"invalid_request_error","param":null,"code":"model_not_supported"},"status":400}';

  const s = session("s-failed", {
    harness: "codex",
    title: "Reply with the single word: pong",
    state: "failed",
    model: "gpt-6-luna",
    effort: "low",
    lastError: raw,
  });

  return model({
    session: s,
    turns: [
      view(turn(s.id, 2, "Reply with the single word: pong", "failed"), [
        I.Error.make({ id: "e2", message: raw.replaceAll(" ", "") }),
      ]),
    ],
  });
};

const MARKDOWN = [
  "## What changed",
  "",
  "The **resume** path now replays from the last acknowledged `Sequence`, so a",
  "dropped connection never loses a frame. See the [spec](https://github.com/lucasdoell/polaris) for the model.",
  "",
  "1. `resume.ts` keeps the cursor per Host",
  "2. The Daemon answers with a `Snapshot` when the gap is too large",
  "   - older Clients still get the full replay",
  "",
  "```ts",
  'export const resume = Effect.fn("resume")(function* (cursor: Sequence) {',
  "  const gap = yield* store.gapSince(cursor);",
  "  // A large gap is cheaper as a snapshot.",
  "  return gap > 500 ? yield* snapshot() : yield* replay(cursor);",
  "});",
  "```",
  "",
  "| Case | Frames | Time |",
  "| --- | ---: | ---: |",
  "| Replay | 480 | 12 ms |",
  "| Snapshot | 1 | 4 ms |",
  "",
  "```mermaid",
  "graph LR",
  "  C[Client] -->|resume cursor| D[Daemon]",
  "  D -->|gap small| R[Replay]",
  "  D -->|gap large| S[Snapshot]",
  "```",
  "",
  "The cost is linear: $$T(n) = c \\cdot n + k$$",
  "",
  "> Replays past 500 frames are rare in practice.",
].join("\n");

/** Rich assistant prose: headings, lists, code, a table, a diagram and math; a folded command. */
export const markdown = (): SessionModel => {
  const s = session("s-markdown", { title: "Resume from the last Sequence", state: "idle" });

  return model({
    session: s,
    turns: [
      view(turn(s.id, 4, "Make resume survive a dropped connection", "completed"), [
        I.CommandExecution.make({
          id: "c4",
          command: "bun test packages/client",
          cwd: s.cwd,
          output: Array.from({ length: 14 }, (_, n) => `(pass) resume > case ${n + 1}`).join("\n"),
          exitCode: 0,
          status: "completed",
        }),
        I.AssistantMessage.make({ id: "m4", text: MARKDOWN }),
      ]),
    ],
  });
};

/** A Turn steered once (landed), with a steer on its way and a follow-up queued. */
export const steer = (): SessionModel => {
  const s = session("s-steer", { title: "Tighten the session rows" });

  return model({
    session: s,
    turns: [
      view(turn(s.id, 6, "Tighten the session rows to 32px", "working"), [
        I.AssistantMessage.make({ id: "m6", text: "Reading `SessionRow.tsx` first." }),
        I.CommandExecution.make({
          id: "c6",
          command: 'rg -n "h-row" packages/ui/src',
          cwd: s.cwd,
          output: "packages/ui/src/rows.tsx:12: h-row\npackages/ui/src/tokens.css:40: --row: 32px",
          exitCode: 0,
          status: "completed",
        }),
        I.UserMessage.make({ id: "steer:1", text: "Keep the 28px variant for compact density" }),
        I.AssistantMessage.make({
          id: "m6b",
          text: "Got it: compact keeps **28px**, the rest go to 32px.",
        }),
      ]),
    ],
  });
};

/** The steer scene's outbox: a steer on its way, one refused, and a queued follow-up. */
export const steerOutbox = (turnId: string): ReadonlyArray<Outgoing<StagedAttachment>> => [
  {
    ...steerOutgoing<StagedAttachment>([], turnId, "And drop the hover shadow"),
    status: "sent",
  },
  {
    ...steerOutgoing<StagedAttachment>([], turnId, "Use the token, not a literal"),
    status: "failed",
    error: MISSED_STEER,
  },
  queuedOutgoing<StagedAttachment>("Then run the gallery and screenshot both themes", []),
];

const attachment = (
  id: string,
  name: string,
  mimeType: string,
  size: number,
  dims: readonly [number, number] | null
) =>
  new Attachment({
    id: AttachmentId.make(id),
    name,
    mimeType,
    size,
    hostPath: `/Users/lucas/.polaris/staging/s-attach/${id}/${name}`,
    width: dims?.[0] ?? null,
    height: dims?.[1] ?? null,
  });

/** Sent images above their prompts: one wide screenshot, then two with a PDF. */
export const attachments = (): SessionModel => {
  const s = session("s-attach", { title: "Match the session rows to the mock", state: "idle" });

  const one = turn(
    s.id,
    2,
    "The rows in this screenshot are too tall; match the mock.",
    "completed",
    [
      attachment(
        "a1",
        "CleanShot 2026-09-30 at 14.02.11@2x.png",
        "image/png",
        812_331,
        [2880, 1800]
      ),
    ]
  );

  const two = turn(s.id, 3, "Here are the light and dark variants, and the spec.", "completed", [
    attachment("a2", "rows-light.png", "image/png", 201_002, [1200, 1600]),
    attachment("a3", "rows-dark.png", "image/png", 198_440, [1600, 1200]),
    attachment("a4", "session-rows-spec.pdf", "application/pdf", 88_120, null),
  ]);

  return model({
    session: s,
    turns: [
      view(one, [I.AssistantMessage.make({ id: "m2", text: "Tightened them to 32px." })]),
      view(two, [I.AssistantMessage.make({ id: "m3", text: "Both variants now match." })]),
    ],
  });
};

export const read = (id: string, path: string) =>
  I.ToolCall.make({
    id,
    name: "Read",
    input: { file_path: path },
    output: null,
    status: "completed",
  });

export const subagentOf = (
  s: SessionId,
  t: TurnId,
  id: string,
  title: string,
  status: "working" | "completed",
  items: ReadonlyArray<TurnItem>,
  live: ReadonlyArray<readonly [string, LiveItem]> = [],
  /** A background agent's flag and its handed-back report. */
  extra: Partial<Pick<Subagent, "background" | "report">> = {}
): SubagentView => ({
  subagent: new Subagent({
    id: SubagentId.make(id),
    sessionId: s,
    turnId: t,
    parentItemId: id,
    title,
    agent: id.includes("explore") ? "Explore" : "general-purpose",
    model: null,
    status,
    startedAt: ago(status === "working" ? 24 : 95),
    endedAt: status === "working" ? null : ago(61),
    ...extra,
  }),
  items,
  live: new Map(live),
});

export const agentCall = (id: string, description: string, prompt: string, done: boolean) =>
  I.ToolCall.make({
    id,
    name: "Agent",
    input: { description, prompt },
    output: null,
    status: done ? "completed" : "running",
  });

/** A Turn that reads in a run of calls and fans out to two Subagents, one done, one working. */
export const subagents = (): SessionModel => {
  const s = session("s-subagents", { title: "Audit the session store" });

  const t = turn(
    s.id,
    7,
    "Audit the session store for places that drop Subagent items.",
    "working"
  );

  const explore = subagentOf(
    s.id,
    t.id,
    "toolu_explore",
    "Find where Subagent events are folded",
    "completed",
    [
      I.ToolCall.make({
        id: "x1",
        name: "Grep",
        input: { pattern: "SubagentStarted" },
        output: null,
        status: "completed",
      }),
      read("x2", "apps/desktop/src/renderer/store/sessionModel.ts"),
      read("x3", "packages/protocol/src/rpc.ts"),
      I.AssistantMessage.make({
        id: "x4",
        text: "**Found it.** `sessionModel.ts` folds `SubagentStarted` and `SubagentEnded` to nothing, and drops every `TurnItemCompleted` that has a `subagentId`.\n\n- Deltas with a `subagentId` land in the Turn's live items\n- `TurnEnded` then clears them, so a Subagent's final text disappears",
      }),
    ]
  );

  const tests = subagentOf(
    s.id,
    t.id,
    "toolu_tests",
    "Run the store tests",
    "working",
    [read("y1", "apps/desktop/src/renderer/store/sessionModel.test.ts")],
    [
      [
        "y2",
        {
          item: I.CommandExecution.make({
            id: "y2",
            command: "bun test apps/desktop/src/renderer/store",
            cwd: s.cwd,
            output: "",
            exitCode: null,
            status: "running",
          }),
          text: "",
          output: "",
        },
      ],
    ]
  );

  return model({
    session: s,
    turns: [
      view(
        t,
        [
          I.AssistantMessage.make({ id: "m1", text: "I'll read the store and its tests first." }),
          read("r1", "apps/desktop/src/renderer/store/sessionModel.ts"),
          read("r2", "apps/desktop/src/renderer/store/store.ts"),
          I.ToolCall.make({
            id: "g1",
            name: "Grep",
            input: { pattern: "subagentId" },
            output: null,
            status: "completed",
          }),
          I.CommandExecution.make({
            id: "c1",
            command: "git log --oneline -5 -- apps/desktop/src/renderer/store",
            cwd: s.cwd,
            output: "a1b2c3d Fold host feeds",
            exitCode: 0,
            status: "completed",
          }),
          agentCall(
            "toolu_explore",
            "Find where Subagent events are folded",
            "Find every place the renderer folds Subagent events and report what is dropped.",
            true
          ),
          agentCall(
            "toolu_tests",
            "Run the store tests",
            "Run the store's tests and report failures.",
            false
          ),
        ],
        [],
        [explore, tests]
      ),
    ],
  });
};

/** 150 Turns of mixed items, for scrolling the virtualized conversation. */
export const long = (): SessionModel => {
  const s = session("s-long", { title: "Long-running refactor", state: "idle", turnCount: 150 });

  // Every third Turn sends two screenshots, so scrolling crosses thumbnails too.
  const shots = (n: number) =>
    n % 3 === 0
      ? [
          attachment(`l${n}x`, `step-${n}-before.png`, "image/png", 300_000, [1600, 1000]),
          attachment(`l${n}y`, `step-${n}-after.png`, "image/png", 300_000, [1000, 1600]),
        ]
      : [];

  const turns = Array.from({ length: 150 }, (_, n) =>
    view(
      turn(
        s.id,
        n,
        `Step ${n + 1}: move the next module onto the new store`,
        "completed",
        shots(n)
      ),
      [
        I.Reasoning.make({
          id: `r${n}`,
          text: "Checking the callers first.",
          startedAt: null,
          endedAt: null,
        }),
        I.AssistantMessage.make({
          id: `m${n}`,
          text: `Moved module ${n + 1}. Its callers now read through the selector, and the old subscription is gone.\n\nNext I'll run the tests for this package.`,
        }),
        I.CommandExecution.make({
          id: `c${n}`,
          command: "bun test packages/store",
          cwd: s.cwd,
          output: Array.from({ length: 12 }, (_, k) => `  ✓ store › case ${k + 1}`).join("\n"),
          exitCode: 0,
          status: "completed",
        }),
        I.FileChange.make({
          id: `f${n}`,
          changes: [
            { path: `packages/store/src/module-${n}.ts`, kind: "modify" },
            { path: `packages/store/src/module-${n}.test.ts`, kind: "add" },
          ],
          status: "completed",
        }),
      ]
    )
  );

  return model({ session: s, turns });
};
