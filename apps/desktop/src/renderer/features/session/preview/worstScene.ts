/**
 * The break-UI scenes (ENG-499): the shell on worst-case data. `worst` is the Workspace bar at
 * its 10-chip limit with long and non-Latin names, `worst-machines` the machine bar (12+
 * Workspaces, a long Host label), `worst-empty` a Workspace with no sessions and
 * `worst-huge` one with 400. The selected Workspace has more active sessions than planets.
 */
import {
  ApprovalRequest,
  CELESTIAL_PLANETS,
  HostId,
  RequestId,
  Sequence,
  SessionId,
  type SessionState,
  TurnId,
  Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { modelFromSnapshot } from "../../../store/hostModel.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { type AppState, initialState, sessionKey } from "../../../store/store.ts";
import { ago, model, session, workspaceId, worktree } from "./fixtures.ts";

export const WORST_SCENES = ["worst", "worst-machines", "worst-empty", "worst-huge"] as const;

export type WorstScene = (typeof WORST_SCENES)[number];

const LOCAL = "local";

const REMOTE = "builder";

const status = (hostId: string, home: string, state: "connected" | "reconnecting") => ({
  state,
  failure: null,
  attempt: state === "connected" ? 0 : 4,
  since: Date.now() - 95_000,
  nextAttemptAt: state === "connected" ? null : Date.now() + 12_000,
  host: {
    hostId: HostId.make(hostId),
    hostname: hostId,
    platform: "darwin-arm64" as const,
    daemonVersion: "0.0.0",
    homeDir: home,
    startedAt: "2026-09-29T00:00:00.000Z",
  },
  capabilities: [],
  epoch: 1,
  latencyMs: state === "connected" ? null : 840,
  lastSeenAt: state === "connected" ? null : Date.now() - 95_000,
});

const HOSTS = (): ReadonlyArray<HostView> => [
  {
    key: LOCAL,
    label: "Aleksandra’s Mac Studio",
    colour: null,
    alias: null,
    kind: "local",
    proofHarness: false,
    status: status("studio", "/Users/aleksandra", "connected"),
  },
  {
    key: REMOTE,
    label: "build-runner-ubuntu-2404-arm64.tail9f3c2.ts.net",
    colour: null,
    alias: "build-runner-ubuntu-2404-arm64.tail9f3c2.ts.net",
    kind: "ssh",
    proofHarness: false,
    status: status("builder", "/home/aleksandra", "reconnecting"),
  },
];

const space = (id: string, name: string, path: string) =>
  new Workspace({
    id: WorkspaceId.make(id),
    path,
    name,
    isGitRepo: true,
    worktreeRoot: `${path}.worktrees`,
    hidden: false,
    registeredAt: "2026-09-01T09:00:00.000Z",
  });

const HOME = "/Users/aleksandra/code";

/** The selected Workspace keeps the shared fixtures' id, so its worktree still resolves. */
const LOCAL_SPACES = [
  space(workspaceId, "polaris", `${HOME}/polaris`),
  space(
    "w-northwind",
    "northwind-industries-holdings-customer-portal-monorepo",
    `${HOME}/northwind-industries-holdings-customer-portal-monorepo`
  ),
  space("w-docs", "ドキュメント翻訳", `${HOME}/ドキュメント翻訳`),
  space("w-a", "a", `${HOME}/a`),
  space("w-launch", "🚀 launch-site", `${HOME}/launch-site`),
  space("w-cafe", "café-crème-ünïcödé", `${HOME}/café-crème-ünïcödé`),
  space(
    "w-java",
    "com.northwind.platform.billing.reconciliation.service",
    `${HOME}/com.northwind.platform.billing.reconciliation.service`
  ),
];

const MORE_SPACES = [
  space("w-ar", "منصة-الفوترة", `${HOME}/منصة-الفوترة`),
  space("w-dotfiles", "dotfiles", `${HOME}/dotfiles`),
  space(
    "w-site",
    "aleksandra-wisniewska-kowalczyk.dev",
    `${HOME}/aleksandra-wisniewska-kowalczyk.dev`
  ),
  space(
    "w-infra",
    "infra-terraform-modules-eu-central-1",
    `${HOME}/infra-terraform-modules-eu-central-1`
  ),
];

const REMOTE_SPACES = [
  space("w-r-kernel", "linux-kernel-6.12-backports-for-raspberry-pi", "/home/aleksandra/kernel"),
  space("w-r-ci", "ci", "/home/aleksandra/ci"),
  space("w-r-model", "local-model-server-llama-cpp-vulkan", "/home/aleksandra/llama"),
];

interface Seed {
  readonly title: string;
  readonly state: SessionState;
  readonly harness?: string;
  readonly preview?: string;
  readonly asks?: string;
  readonly fork?: boolean;
  readonly days?: number;
}

const LONG_ASK =
  "Run bun test apps/daemon/src/verification --rerun-each 50 with POLARIS_PBT_RUNS=500 POLARIS_PBT_SEED=1849302 and write the failing traces to /tmp/polaris-verification-traces";

/** More than the 12 planets, mixing every failure across the first rows. */
const SEEDS: ReadonlyArray<Seed> = [
  {
    title:
      "Investigate why the Daemon’s event store replays every Turn twice after a crash during compaction on the Raspberry Pi 4",
    state: "needs-you",
    asks: LONG_ASK,
  },
  {
    title: "セッションストアのホットパスを調査して、長い再生で支配的なフォールドを報告する",
    state: "working",
    harness: "codex",
  },
  { title: "تحقق من سبب فشل اختبارات المتجر تحت الحمل", state: "idle" },
  { title: "🔥 Fix the flaky upload-pack test 🧪🐛👩‍💻", state: "failed" },
  {
    title: "Kiểm tra lỗi đồng bộ hoá Ngữ cảnh khi kết nối lại Host ở xa",
    state: "working",
    harness: "opencode",
  },
  { title: "ตรวจสอบการเชื่อมต่อใหม่ของโฮสต์ระยะไกลเมื่อเครือข่ายหลุด", state: "dormant", days: 412 },
  { title: "", state: "idle" },
  { title: "x", state: "starting" },
  {
    title: "apps/desktop/src/renderer/features/constellation/ui/statsCharts.tsx",
    state: "in-terminal",
  },
  {
    title: "lucas/eng-169-research-herdr-dagrs-dag-model-and-the-worker-claim-loop",
    state: "limited",
    fork: true,
  },
  {
    title: "Fork of Investigate why the Daemon’s event store replays every Turn twice",
    state: "working",
    fork: true,
  },
  {
    title: "Review: ENG-512 panels on a ground, the horizon, pill title bar",
    state: "idle",
    harness: "gemini",
  },
  {
    title: "Spike GPUI review screen",
    state: "needs-you",
    harness: "codex",
    asks: "Run cargo build --release",
  },
  { title: "Rebuild the site", state: "dormant", days: 3 },
  {
    title: "A session from a newer Harness this build doesn’t know",
    state: "working",
    harness: "cursor-agent",
  },
];

const seeded = (seed: Seed, index: number, workspace: WorkspaceId): SessionModel => {
  const s = session(`s-worst-${index}`, {
    workspaceId: workspace,
    title: seed.title,
    state: seed.state,
    harness: seed.harness ?? "claude",
    // As the Daemon assigns them: every planet once, then shared; the last from a Daemon without.
    celestial:
      index === SEEDS.length - 1
        ? null
        : (CELESTIAL_PLANETS[index % CELESTIAL_PLANETS.length] ?? null),
    parentSessionId: seed.fork === true ? SessionId.make("s-worst-0") : null,
    lastReplyPreview:
      "The bench shows 1,284 wakeups a second while idle, almost all from the language server’s file watcher on node_modules.",
    createdAt: ago((seed.days ?? 0) * 86_400 + index * 600 + 90),
  });

  const pending =
    seed.asks === undefined
      ? []
      : [
          new ApprovalRequest({
            id: RequestId.make(`r-worst-${index}`),
            sessionId: s.id,
            turnId: TurnId.make(`${s.id}-t1`),
            kind: "command",
            title: seed.asks,
            detail: seed.asks,
            options: [],
            openedAt: ago(42 * 60),
          }),
        ];

  return model({ session: s, pendingApprovals: pending });
};

const STATES: ReadonlyArray<SessionState> = ["idle", "working", "dormant", "needs-you", "failed"];

/** 400 sessions: the unpaginated sidebar list at its realistic upper bound. */
const huge = () =>
  Array.from({ length: 400 }, (_, i) =>
    seeded(
      {
        title: `Session ${i + 1}: ${SEEDS[i % SEEDS.length]?.title ?? ""}`,
        state: STATES[i % STATES.length] ?? "idle",
      },
      i,
      workspaceId
    )
  );

const sessionsFor = (scene: WorstScene): ReadonlyArray<SessionModel> => {
  if (scene === "worst-empty") return [];

  if (scene === "worst-huge") return huge();

  return SEEDS.map((seed, i) => seeded(seed, i, workspaceId));
};

const snapshot = (
  workspaces: ReadonlyArray<Workspace>,
  models: ReadonlyArray<SessionModel>,
  withWorktree: boolean
) => ({
  ...modelFromSnapshot({
    sequence: Sequence.make(90),
    workspaces: [...workspaces],
    worktrees: withWorktree ? [worktree] : [],
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
});

/** The scene's store, and the session it opens (null opens the Workspace's own page). */
export const worstState = (scene: WorstScene) => {
  const models = sessionsFor(scene);
  const machines = scene === "worst-machines";
  const local = machines ? [...LOCAL_SPACES, ...MORE_SPACES] : LOCAL_SPACES;

  const state: AppState = {
    ...initialState,
    hosts: [...HOSTS()],
    hostModels: {
      [LOCAL]: snapshot(local, models, true),
      [REMOTE]: snapshot(REMOTE_SPACES, [], false),
    },
    sessions: Object.fromEntries(
      models.flatMap((m) => (m.session === null ? [] : [[sessionKey(LOCAL, m.session.id), m]]))
    ),
  };

  return { state, hostKey: LOCAL, shown: models[0]?.session?.id ?? null };
};
