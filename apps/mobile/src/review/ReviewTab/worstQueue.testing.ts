/**
 * Worst-case queues for the Review tab (break-ui): long, empty, RTL and CJK titles, a long host
 * name, many Criticals, every risk state, huge counts; plus one turn, none, and 200.
 */
import { RiskFinding } from "@polaris/protocol";
import { applyHostItem, emptyHostFeed } from "../../home/feed/fold.ts";
import {
  type SessionInput,
  session,
  snapshot,
  summary,
  synchronized,
  workspace,
} from "../../home/fixtures.testing.ts";
import type { HomeHost } from "../../home/model/home.ts";
import { unreachableRpi, sixAway } from "../../home/worstCase.testing.ts";
import { finding, summary as riskSummary } from "../review.testing.ts";
import type { QueueTurn, TurnRisk } from "./queue.ts";

interface QueueSession extends SessionInput {
  readonly minutes: number;
  readonly risk: TurnRisk;
  readonly files: QueueTurn["files"];
}

export interface DevQueue {
  readonly hosts: ReadonlyArray<HomeHost>;
  readonly turns: ReadonlyMap<string, QueueTurn>;
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const WORKSPACES = [
  workspace("w1", "polaris"),
  workspace("w2", "northwind-industries-customer-portal-monorepo"),
  workspace("w3", "设计系统组件库"),
  workspace("w4", "مشروع-الواجهة"),
  workspace("w5", "a"),
];

const host = (hostId: string, name: string, sessions: ReadonlyArray<QueueSession>): HomeHost => ({
  hostId,
  name,
  connection: "connected",
  followed: {
    state: [
      snapshot({
        workspaces: WORKSPACES,
        sessions: sessions.map((s) =>
          summary(session({ ...s, updatedAt: minutesAgo(s.minutes), acceptedThroughIndex: null }))
        ),
      }),
      synchronized(),
    ].reduce(applyHostItem, emptyHostFeed),
    seen: true,
    error: null,
  },
});

const queue = (hosts: ReadonlyArray<readonly [string, string, ReadonlyArray<QueueSession>]>) => ({
  hosts: hosts.map(([id, name, sessions]) => host(id, name, sessions)),
  turns: new Map(
    hosts.flatMap(([id, , sessions]) =>
      sessions.map((s): [string, QueueTurn] => [
        `${id}/${s.id}:${s.turnCount ?? 1}`,
        { turnId: `t-${s.id}`, number: s.turnCount ?? 1, files: s.files, risk: s.risk },
      ])
    )
  ),
});

const read = (
  findings: ReadonlyArray<RiskFinding>,
  status: "completed" | "running" = "completed"
) => ({ kind: "summary", summary: riskSummary(status, findings) }) as const;

const titled = (f: RiskFinding, title: string) =>
  new RiskFinding({
    id: f.id,
    identity: f.identity,
    source: f.source,
    ruleId: f.ruleId,
    path: f.path,
    lines: f.lines,
    severity: f.severity,
    confidence: f.confidence,
    title,
    reason: f.reason,
    suggestion: f.suggestion,
    status: f.status,
    resolution: f.resolution,
  });

const criticals = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, n) => finding(`${prefix}${n}`, "critical"));

const LONG_PATH =
  "apps/northwind-industries-customer-portal/src/features/billing/reconciliation/__generated__/InvoiceLineItemReconciliationServiceClient.generated.ts";

const worstTop = [
  titled(
    finding("k", "critical", { path: LONG_PATH, line: 2 }),
    "Signing key committed to the generated client and shipped in every build of the customer portal"
  ),
  ...criticals(11, "c"),
  ...Array.from({ length: 140 }, (_, n) => finding(`m${n}`, n % 2 === 0 ? "medium" : "low")),
];

const LONG_TITLE =
  "Investigate why the Raspberry Pi's Daemon drops the relay socket after the laptop sleeps for more than twenty minutes";

const WORST: DevQueue = queue([
  [
    "studio",
    "lucas-mac-studio.taild0d828.ts.net",
    [
      {
        id: "q-long",
        title: LONG_TITLE,
        workspaceId: "w2",
        turnCount: 9_999,
        minutes: 2,
        files: { count: 1_284, added: 123_456, removed: 98_765 },
        risk: read(worstTop),
      },
      {
        id: "q-empty",
        title: "",
        harness: "codex",
        minutes: 4,
        files: { count: 1, added: 1, removed: 0 },
        risk: read([finding("e1", "high")]),
      },
      {
        id: "q-rtl",
        title: "إصلاح خطأ المزامنة في تطبيق الجوال عند انقطاع الاتصال",
        workspaceId: "w4",
        minutes: 6,
        files: null,
        risk: read(criticals(2, "r")),
      },
      {
        id: "q-cjk",
        title: "修复移动端同步问题并更新文档",
        workspaceId: "w3",
        harness: "opencode",
        minutes: 8,
        files: { count: 2, added: 40, removed: 3 },
        risk: { kind: "failed", message: "The reviewer's Harness exited with status 137" },
      },
      {
        id: "q-running",
        title: "🚀 Ship the 0.4 release notes 🎉",
        minutes: 10,
        files: { count: 3, added: 12, removed: 1 },
        risk: read([finding("p1", "low")], "running"),
      },
      {
        id: "q-unreviewed",
        title: "x",
        workspaceId: "w5",
        minutes: 12,
        files: { count: 0, added: 0, removed: 0 },
        risk: { kind: "unreviewed" },
      },
      {
        id: "q-loading",
        title: "Still reading",
        minutes: 14,
        files: null,
        risk: { kind: "loading" },
      },
    ],
  ],
  [
    "rpi",
    "x",
    [
      {
        id: "q-clean-long",
        title: LONG_TITLE,
        workspaceId: "w2",
        turnCount: 1_284,
        minutes: 30,
        files: { count: 1_284, added: 9_999, removed: 9_999 },
        risk: read([]),
      },
      {
        id: "q-clean-rtl",
        title: "مراجعة واجهة الجوال",
        workspaceId: "w4",
        minutes: 40,
        files: { count: 1, added: 2, removed: 2 },
        risk: read([]),
      },
      {
        id: "q-dismissed",
        title: "Only a dismissed Critical",
        minutes: 50,
        files: { count: 2, added: 3, removed: 1 },
        risk: read([finding("d1", "critical", { status: "dismissed" })]),
      },
    ],
  ],
]);

const ONE: DevQueue = queue([
  [
    "studio",
    "mac-studio",
    [
      {
        id: "q-one",
        title: "One",
        turnCount: 1,
        minutes: 1,
        files: { count: 1, added: 1, removed: 1 },
        risk: read([finding("o1", "critical")]),
      },
    ],
  ],
]);

const EMPTY: DevQueue = queue([["studio", "mac-studio", []]]);

const HUGE: DevQueue = queue([
  [
    "studio",
    "mac-studio",
    Array.from({ length: 200 }, (_, n) => ({
      id: `q${n}`,
      title: `Turn ${n + 1} of 200`,
      harness: (["claude", "codex", "opencode"] as const)[n % 3] ?? "claude",
      workspaceId: `w${(n % 5) + 1}`,
      turnCount: n + 1,
      minutes: n,
      files: { count: n + 1, added: n * 10, removed: n },
      risk: read(n % 4 === 0 ? [] : criticals(n % 3, `h${n}-`)),
    })),
  ],
]);

export const devQueues = {
  worst: WORST,
  empty: EMPTY,
  one: ONE,
  huge: HUGE,
  none: { hosts: [], turns: new Map() },
  offline: { hosts: [unreachableRpi], turns: new Map() },
  unreachable: { hosts: sixAway, turns: new Map() },
} satisfies Record<string, DevQueue>;
