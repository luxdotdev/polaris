/**
 * Worst-case Hosts for Home, the rows and the needs you inbox (break-ui): long and unbreakable
 * names, missing fields, non-Latin and RTL text, huge counts, away Hosts. Built from the feed fold.
 */
import type { ConnectionState, HostStreamItem } from "@polaris/protocol";
import { applyHostItem, emptyHostFeed } from "./feed/fold.ts";
import {
  commandApproval,
  constellation,
  minutesAgo,
  question,
  type SessionInput,
  session,
  snapshot,
  summary,
  synchronized,
  workspace,
} from "./fixtures.testing.ts";
import type { HomeHost } from "./model/home.ts";

export type DevHomeData = "worst" | "empty" | "one" | "huge";

const host = (
  hostId: string,
  name: string,
  items: ReadonlyArray<HostStreamItem>,
  connection: ConnectionState = "connected"
): HomeHost => ({
  hostId,
  name,
  connection,
  followed: { state: items.reduce(applyHostItem, emptyHostFeed), seen: true, error: null },
});

const at = (input: SessionInput & { readonly minutes: number }) =>
  session({ ...input, updatedAt: minutesAgo(input.minutes) });

const LONG_PATH =
  "/Users/aleksandra.wisniewska-kowalczyk/code/northwind-industries-customer-portal-monorepo/node_modules/.bun/@react-native+virtualized-lists@0.88.0+c4fe011fe8ab1ca0/node_modules/@react-native/virtualized-lists/Lists/VirtualizedSectionList.js";

const LONG_TITLE =
  "Investigate why the Raspberry Pi's Daemon drops the relay socket after the laptop sleeps for more than twenty minutes";

const FIVE_LINES = [
  "git fetch origin",
  "git rebase origin/main",
  "bun install --frozen-lockfile",
  "bun run typecheck",
  "bun run test --filter=@polaris/mobile",
].join("\n");

const LONG_ERROR =
  "TypeError: Cannot read properties of undefined (reading 'sessions') at foldHostItem (apps/mobile/src/home/feed/fold.ts:194:31)\n    at Array.reduce (<anonymous>)";

const studioWorkspaces = [
  workspace("w1", "polaris"),
  workspace("w2", "northwind-industries-customer-portal-monorepo"),
  workspace("w3", "a"),
  workspace("w4", "设计系统组件库"),
  workspace("w5", "مشروع-الواجهة"),
  workspace("w6", "🚀-launch"),
];

const studioSessions = [
  summary(at({ id: "s-long", title: LONG_TITLE, state: "needs-you", minutes: 3, turnCount: 128 }), [
    commandApproval("s-long", "r1", `cat ${LONG_PATH}`, minutesAgo(1_440 * 12)),
  ]),
  summary(at({ id: "s-empty", title: "", state: "needs-you", harness: "codex", minutes: 9 }), [
    question(
      "s-empty",
      "r2",
      "Should the migration keep the legacy session_events_v1 table until every Host has upgraded past 0.4, or drop it now and backfill from the archive on the next launch?",
      ["Keep it until every Host upgrades", "Drop it now and backfill", "Ask again after 0.4"],
      minutesAgo(300)
    ),
  ]),
  summary(at({ id: "s-x", title: "x", state: "needs-you", harness: "aider", minutes: 20 }), [
    commandApproval("s-x", "r3", FIVE_LINES, minutesAgo(61)),
  ]),
  summary(
    at({ id: "s-rtl", title: "إصلاح خطأ المزامنة في تطبيق الجوال", state: "needs-you", minutes: 1 }),
    [commandApproval("s-rtl", "r4", "apps/mobile/src/home", minutesAgo(45), "file-change")]
  ),
  summary(
    at({ id: "s-cjk", title: "修复移动端同步问题并更新文档", workspaceId: "w4", minutes: 2 }),
    [commandApproval("s-cjk", "r5", "mcp__polaris__claim", minutesAgo(30), "tool")]
  ),
  summary(
    at({ id: "s-bare", title: "🚀 Ship the 0.4 release notes 🎉", state: "needs-you", minutes: 5 })
  ),
  summary(
    at({
      id: "w-long",
      title: LONG_TITLE,
      state: "working",
      workspaceId: "w2",
      turnCount: 9_999,
      minutes: 0,
      lastReplyPreview: `Reading ${LONG_PATH}`,
    })
  ),
  summary(at({ id: "w-x", title: "x", state: "working", harness: "opencode", minutes: 1 })),
  summary(
    at({
      id: "w-rtl",
      title: "مراجعة واجهة الجوال",
      state: "starting",
      workspaceId: "w5",
      harness: "codex",
      minutes: 2,
      lastReplyPreview: "جارٍ قراءة الملفات…",
    })
  ),
  summary(at({ id: "w-lead", title: "Lead", state: "working", minutes: 1 })),
  summary(
    at({
      id: "d-fail",
      title: "Nightly bench on the Raspberry Pi",
      state: "failed",
      lastError: LONG_ERROR,
      minutes: 90,
    })
  ),
  summary(at({ id: "d-dormant", title: "Dormant spike", state: "dormant", minutes: 2_000 })),
  summary(at({ id: "d-limited", title: "Usage limit", state: "limited", minutes: 400 })),
  summary(at({ id: "d-term", title: "Terminal", state: "in-terminal", minutes: 500 })),
  summary(at({ id: "d-review", title: "Ready", turnCount: 3, minutes: 60 * 24 * 400 })),
  summary(at({ id: "d-zero", title: "No turns yet", turnCount: 0, minutes: 30 })),
];

const studio = host("studio", "lucas-mac-studio.taild0d828.ts.net", [
  snapshot({
    workspaces: studioWorkspaces,
    sessions: studioSessions,
    constellations: [
      constellation(
        "Rebuild the mobile chrome on the instrument sheet across every screen and theme",
        "w-lead"
      ),
      constellation("c", "d-review", "w1", "completed"),
    ],
  }),
  synchronized(),
]);

const rpi = host(
  "rpi",
  "x",
  [
    snapshot({
      workspaces: [workspace("p1", "polaris")],
      sessions: [
        summary(at({ id: "p-ask", title: "Away", state: "needs-you", minutes: 15 }), [
          commandApproval("p-ask", "q1", "sudo systemctl restart polaris", minutesAgo(15)),
        ]),
        summary(at({ id: "p-work", title: "Away and working", state: "working", minutes: 15 })),
      ],
    }),
    synchronized(),
  ],
  "reconnecting"
);

const vm = host("vm", "192.168.100.254", [], "offline");

const one = host("studio", "mac-studio", [
  snapshot({
    workspaces: [workspace("w1", "polaris")],
    sessions: [
      summary(at({ id: "o-ask", title: "One", state: "needs-you", minutes: 1, turnCount: 1 }), [
        commandApproval("o-ask", "r1", "bun test", minutesAgo(1)),
      ]),
      summary(at({ id: "o-work", title: "One working", state: "working", minutes: 1 })),
    ],
  }),
  synchronized(),
]);

const HARNESSES = ["claude", "codex", "opencode"] as const;

const many = (count: number, prefix: string, input: Partial<SessionInput>) =>
  Array.from({ length: count }, (_, n) =>
    summary(
      at({
        id: `${prefix}${n}`,
        title: `${prefix} ${n + 1}`,
        harness: HARNESSES[n % HARNESSES.length] ?? "claude",
        minutes: n,
        ...input,
      }),
      input.state === "needs-you"
        ? [commandApproval(`${prefix}${n}`, `${prefix}r${n}`, "bun test", minutesAgo(n))]
        : []
    )
  );

const huge = host("studio", "mac-studio", [
  snapshot({
    workspaces: Array.from({ length: 40 }, (_, n) => workspace(`w${n}`, `workspace-${n + 1}`)),
    sessions: [
      ...many(120, "Needs you", { state: "needs-you" }),
      ...many(30, "Working", { state: "working" }),
      ...many(50, "Idle", { state: "idle", turnCount: 2 }),
    ],
  }),
  synchronized(),
]);

const empty = host("studio", "mac-studio", [snapshot({}), synchronized()]);

export const devHomeHosts: Record<DevHomeData, ReadonlyArray<HomeHost>> = {
  worst: [studio, rpi, vm],
  empty: [empty],
  one: [one],
  huge: [huge],
};
