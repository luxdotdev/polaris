/**
 * The thread gallery's data (development builds only, `ThreadGallery.tsx`): demo turns, the
 * worst case a real session produces (break-ui), one of everything, and an empty session.
 */
import {
  type AgentSession,
  Model,
  ModelId,
  SessionStreamItem,
  Sequence,
  type Turn,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import { sessionId, snapshot, turn } from "./daemon.testing.ts";

export type Dataset = "demo" | "worst" | "one" | "empty" | "started";

export interface GalleryData {
  readonly session: Partial<AgentSession>;
  readonly workspaceName: string;
  readonly turns: ReadonlyArray<{ readonly turn: Turn; readonly items: ReadonlyArray<TurnItem> }>;
  /** Pushed after the Snapshot: what is still streaming into the Turn in flight. */
  readonly live: ReadonlyArray<SessionStreamItem>;
}

/** What the gallery's Claude Code lists: the fake Host answers no `harness.models` itself. */
export const GALLERY_MODELS: ReadonlyArray<Model> = [
  new Model({
    id: ModelId.make("claude-opus-5-5"),
    name: "Opus 5.5",
    description: "Most capable",
    efforts: ["low", "medium", "high", "max"],
    defaultEffort: "high",
    isDefault: true,
  }),
  new Model({
    id: ModelId.make("claude-sonnet-5"),
    name: "Sonnet 5",
    description: "Fast and capable",
    efforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    isDefault: false,
  }),
];

const START = Date.parse("2026-10-27T09:24:00.000Z");

const iso = (seconds: number) => new Date(START + seconds * 1000).toISOString();

type Status = "running" | "completed" | "failed" | "declined";

const reply = (id: string, text: string) => TurnItem.cases.AssistantMessage.make({ id, text });

const command = (
  id: string,
  line: string,
  exitCode: number | null = 0,
  status: Status = "completed"
) =>
  TurnItem.cases.CommandExecution.make({
    id,
    command: line,
    cwd: "/repo",
    output: "",
    exitCode,
    status,
  });

const edit = (id: string, paths: ReadonlyArray<string>, status: Status = "completed") =>
  TurnItem.cases.FileChange.make({
    id,
    changes: paths.map((path) => ({ path, kind: "modify" as const })),
    status,
  });

const read = (id: string, path: string) =>
  TurnItem.cases.ToolCall.make({
    id,
    name: "Read",
    kind: "read",
    input: { file_path: path },
    output: null,
    status: "completed",
  });

const mcp = (id: string, server: string, tool: string, status: Status = "completed") =>
  TurnItem.cases.ToolCall.make({
    id,
    name: `mcp__${server}__${tool}`,
    kind: "mcp",
    mcp: { server, tool },
    input: {},
    output: null,
    status,
  });

const ended = (index: number, seconds: number, took: number, fields: Partial<Turn> = {}): Turn =>
  turn(index, { startedAt: iso(seconds), endedAt: iso(seconds + took), ...fields });

const DEMO: GalleryData = {
  session: { title: "Polaris planning", model: "claude-opus-5-5", state: "idle" },
  workspaceName: "polaris",
  turns: [
    {
      turn: ended(0, 0, 101, { prompt: "Split the planning page into sections" }),
      items: [
        reply("a", "Looking at the planning page."),
        read("b", "src/planning.tsx"),
        read("c", "src/hosts.tsx"),
        edit("d", ["src/planning.tsx", "src/hosts.tsx"]),
        command("e", "bun test"),
        reply("f", "Split the planning page into three sections."),
      ],
    },
    {
      turn: ended(1, 300, 24, { prompt: "Run the tests again" }),
      items: [command("a", "bun test"), reply("b", "All 412 tests pass.")],
    },
  ],
  live: [],
};

const ONE: GalleryData = {
  session: { title: "A", model: null, state: "idle" },
  workspaceName: "a",
  turns: [
    {
      turn: ended(0, 0, 1, { prompt: "Fix it" }),
      items: [edit("a", ["a.ts"]), command("b", "bun test"), reply("c", "Done.")],
    },
  ],
  live: [],
};

const EMPTY: GalleryData = {
  session: { title: "", model: null, state: "idle" },
  workspaceName: "polaris",
  turns: [],
  live: [],
};

/** Just sent from New session (MX-AS): starting, turn 1, its first tool run streaming. */
const STARTED = (): GalleryData => ({
  session: {
    title: "Fix the relay reconnect backoff when the tunnel flaps",
    model: "claude-opus-5-5",
    state: "starting",
  },
  workspaceName: "polaris",
  turns: [
    {
      turn: turn(0, {
        prompt:
          "Fix the relay reconnect backoff when the tunnel flaps. Cap it at 30s and keep the jitter.",
        status: "working",
        startedAt: new Date().toISOString(),
        endedAt: null,
      }),
      items: [],
    },
  ],
  live: [
    SessionStreamItem.cases.Synchronized.make({ sequence: Sequence.make(1) }),
    SessionStreamItem.cases.ItemProgress.make({
      turnId: TurnId.make("t-0"),
      item: TurnItem.cases.ToolCall.make({
        id: "a",
        name: "Read",
        kind: "read",
        input: { file_path: "packages/client/src/relay/reconnect.ts" },
        output: null,
        status: "running",
      }),
      subagentId: null,
    }),
  ],
});

const HOME = "/Users/aleksandra.wisniewska-kowalczyk/code/northwind-billing-reconciliation";

const LONG_FILE =
  "ReconciliationLedgerBackfillMigrationCoordinatorServiceImplementation.integration.test.ts";

const URL =
  "https://northwind-industries-holdings.atlassian.net/wiki/spaces/BILLING/pages/4128773021/Ledger+API+v3+migration+runbook?focusedCommentId=99812734#comment-99812734";

const CODE = [
  "```ts",
  `const ledgerClient = createLedgerClient({ baseUrl: process.env.NORTHWIND_LEDGER_API_BASE_URL ?? "https://ledger.internal.northwind-industries-holdings.example.com/v3", retries: 5 });`,
  "await backfill(ledgerClient, { from: '2026-07-01', to: '2026-09-30' });",
  "```",
].join("\n");

const PARAGRAPH =
  "Reconciled the invoice against the ledger entry, found the currency rounding drift on the EUR→PLN conversion, and rewrote the comparator so it compares minor units instead of floats.";

/** About 6,000 words: a summary Turn that a long migration actually ends on. */
const ENORMOUS = [
  "## What changed",
  ...Array.from({ length: 36 }, (_, n) => `${n + 1}. ${PARAGRAPH} ${PARAGRAPH}`),
  CODE,
  `See ${URL} for the runbook and \`${HOME}/src/ledger/${LONG_FILE}\` for the new tests.`,
].join("\n\n");

const POLISH_PROMPT =
  "Zaktualizuj proszę migrację rozliczeń dla Aleksandry Wiśniewskiej-Kowalczyk i sprawdź, czy faktury z trzeciego kwartału zgadzają się z księgą główną. Nie ruszaj gałęzi produkcyjnej.";

const RTL_PROMPT =
  "תקן את הבדיקות שנכשלו · أصلح الاختبارات الفاشلة في وحدة الفوترة · 請修正失敗したテスト 🧑‍🧑‍🧒‍🧒🏳️‍⚧️👩🏽‍💻";

const MIXED_REPLY =
  "Tiếng Việt: Đã cập nhật hóa đơn. ภาษาไทย: ปรับปรุงใบแจ้งหนี้แล้ว. العربية: تم تحديث الفاتورة. 👩🏽‍💻🧑‍🧑‍🧒‍🧒 Done.";

/** 40 reads, 25 commands, 30 files, MCP servers with long names: one huge folded run. */
const manyTools = (): ReadonlyArray<TurnItem> => [
  ...Array.from({ length: 40 }, (_, n) => read(`r${n}`, `${HOME}/src/ledger/part-${n}.ts`)),
  ...Array.from({ length: 25 }, (_, n) =>
    command(`c${n}`, `bun test src/ledger/part-${n}.test.ts`)
  ),
  ...Array.from({ length: 30 }, (_, n) => edit(`e${n}`, [`src/ledger/part-${n}.ts`])),
  ...Array.from({ length: 12 }, (_, n) => mcp(`m${n}`, "claude_ai_Linear", "save_issue")),
  mcp("p", "plugin_northwind-tools_northwind_internal_billing_observability", "query_ledger_drift"),
];

const LONG_COMMAND = `cd ${HOME} && POLARIS_PBT_RUNS=500 NODE_OPTIONS=--max-old-space-size=8192 bun test src/ledger/${LONG_FILE} --timeout 600000`;

const worstTurns = (): GalleryData["turns"] => [
  {
    turn: ended(0, 0, 41, { prompt: POLISH_PROMPT, userTurnNumber: 1279 }),
    items: [
      reply("a", `Reading the runbook at ${URL} first.`),
      read("b", `${HOME}/src/ledger/${LONG_FILE}`),
      reply("c", `The comparator is in \`${HOME}/src/ledger/compare.ts\`.\n\n${CODE}`),
    ],
  },
  // 26 hours, 1,284 files: a long-running migration Turn.
  {
    turn: ended(1, 60, 94_440, { prompt: "Backfill Q3", userTurnNumber: 1280 }),
    items: [
      ...manyTools(),
      edit(
        "bulk",
        Array.from({ length: 1284 }, (_, n) => `src/invoices/2026-q3/invoice-${n}.json`)
      ),
      reply("z", ENORMOUS),
    ],
  },
  // A failed Turn: the reply, then the failing command and the error after it.
  {
    turn: ended(2, 100_000, 312, {
      prompt: "Run the long integration suite",
      status: "failed",
      userTurnNumber: 1281,
    }),
    items: [
      reply("a", "Running the integration suite now."),
      command("b", LONG_COMMAND, 137, "failed"),
      command("c", "git push --force-with-lease origin HEAD", null, "declined"),
      TurnItem.cases.Error.make({
        id: "d",
        message:
          "Claude Code exited with code 137 (killed: out of memory) while running the integration suite; the Turn ended before it replied.",
      }),
    ],
  },
  // Stopped from the phone: its plan was left half done and a command still running.
  {
    turn: ended(3, 101_000, 7, {
      prompt: RTL_PROMPT,
      status: "interrupted",
      userTurnNumber: 1282,
    }),
    items: [
      reply("a", MIXED_REPLY),
      TurnItem.cases.Plan.make({
        id: "b",
        steps: [
          { text: "Read the ledger", status: "completed", detail: null },
          { text: "Backfill", status: "in-progress", detail: null },
          { text: "Verify", status: "pending", detail: null },
        ],
        explanation: null,
      }),
      command("c", "bun run backfill --quarter 2026-Q3", null, "running"),
    ],
  },
  // An empty Turn: a prompt of only attachments that failed to stage, nothing came back.
  { turn: ended(4, 102_000, 0, { prompt: "", userTurnNumber: 1283 }), items: [] },
  // The Turn in flight.
  {
    turn: turn(5, {
      prompt: "Now verify every invoice against the ledger and tell me which ones drifted",
      status: "working",
      startedAt: iso(102_100),
      endedAt: null,
      userTurnNumber: 1284,
    }),
    items: [reply("a", "Verifying 1,284 invoices.")],
  },
];

const streaming = (index: number): ReadonlyArray<SessionStreamItem> => {
  const turnId = TurnId.make(`t-${index}`);

  return [
    SessionStreamItem.cases.Synchronized.make({ sequence: Sequence.make(1) }),
    SessionStreamItem.cases.ItemProgress.make({
      turnId,
      item: command("live", LONG_COMMAND, null, "running"),
      subagentId: null,
    }),
    SessionStreamItem.cases.Delta.make({
      turnId,
      itemId: "streaming",
      field: "text",
      text: `So far 312 of 1,284 invoices match. Drifted: ${URL}`,
      subagentId: null,
    }),
  ];
};

const WORST = (): GalleryData => ({
  session: {
    title:
      "Migrate the billing reconciliation worker to the Ledger API v3 and backfill Q3 invoices for Northwind Industries Holdings",
    model: "claude-opus-5-5[1m]",
    state: "working",
  },
  workspaceName: "northwind-billing-reconciliation-service-monorepo",
  turns: worstTurns(),
  live: streaming(5),
});

export const DATASETS: Readonly<Record<Dataset, () => GalleryData>> = {
  demo: () => DEMO,
  worst: WORST,
  one: () => ONE,
  empty: () => EMPTY,
  started: STARTED,
};

/** The dataset's Snapshot, as the Host sends it first. */
export const snapshotOf = (data: GalleryData) => snapshot(data.turns, data.session);

export { sessionId };
