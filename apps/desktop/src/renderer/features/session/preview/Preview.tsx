/**
 * The session view on fixtures, for screenshots against Paper
 * (`scripts/sessionScreens.ts`): `#preview/<scene>` renders the shell with one
 * scene selected, on a stand-in bridge and store, no Daemon involved. Its own chunk.
 */
import {
  Capability,
  HARNESS_CATALOGUE,
  type HarnessStatus,
  HostId,
  PlanLimit,
  Sequence,
  UsageStreamItem,
} from "@polaris/protocol";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type {
  HostView,
  PolarisApi,
  RequestInput,
  RequestMethod,
  Result,
  SubscriptionKind,
} from "../../../../shared/api.ts";
import { modelFromSnapshot } from "../../../store/hostModel.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { App } from "../../../app/App.tsx";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { type AppState, type Connection, initialState, sessionKey } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { patchSessionUi, uiKey } from "../state.ts";
import { COMMANDS } from "./commands.ts";
import {
  approval,
  attachments,
  failed,
  interrupted,
  long,
  markdown,
  planning,
  question,
  steer,
  steerOutbox,
  subagents,
  workspace,
  workspaceId,
  worktree,
} from "./fixtures.ts";
import { MODELS, PATCH } from "./fixtureData.ts";

const HOST = "local";

const host: HostView = {
  key: HOST,
  label: "Mac Studio",
  colour: null,
  alias: null,
  proofHarness: false,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: {
      hostId: HostId.make("h-studio"),
      hostname: "studio",
      platform: "darwin-arm64",
      daemonVersion: "0.0.0",
      homeDir: "/Users/lucas",
      startedAt: "2026-09-29T00:00:00.000Z",
    },
    capabilities: Capability.literals,
    epoch: 1,
    latencyMs: null,
    lastSeenAt: null,
  },
};

const SCENES = {
  session: planning,
  approval,
  question,
  interrupted,
  failed,
  long,
  markdown,
  steer,
  attachments,
  subagents,
} as const;

const SCENE_NAMES = [
  "session",
  "approval",
  "question",
  "interrupted",
  "failed",
  "long",
  "markdown",
  "steer",
  "attachments",
  "subagents",
  "new",
  "setup",
  "none-ready",
  "usage-2",
  "usage-3",
] as const;

type Scene = (typeof SCENE_NAMES)[number];

const harnessOf = (input: RequestInput<RequestMethod>) =>
  "harness" in input && input.harness === "codex" ? "codex" : "claude";

type Probe = readonly [status: HarnessStatus, version: string | null];

/**
 * What each scene's Host has: mostly ready; on "setup" a sign-in and not-installed ones;
 * on "none-ready" nothing ready (an outdated Claude Code, below the floor).
 */
const HOSTS: Readonly<Record<"default" | "setup" | "none-ready", Readonly<Record<string, Probe>>>> =
  {
    default: {
      claude: ["ready", "2.1.283"],
      codex: ["ready", "0.157.1"],
      opencode: ["ready", "1.18.33"],
      gemini: ["outdated", "0.21.0"],
      copilot: ["not-installed", null],
    },
    setup: {
      claude: ["ready", "2.1.283"],
      codex: ["needs-sign-in", "0.157.1"],
      opencode: ["not-installed", null],
      gemini: ["outdated", "0.21.0"],
      copilot: ["not-installed", null],
    },
    "none-ready": {
      claude: ["outdated", "2.0.9"],
      codex: ["not-installed", null],
      opencode: ["needs-sign-in", "1.18.33"],
      gemini: ["not-installed", null],
      copilot: ["not-installed", null],
    },
  };

const hostFor = (scene: Scene) =>
  HOSTS[scene === "setup" || scene === "none-ready" ? scene : "default"];

const availability = (scene: Scene) => {
  const probes = hostFor(scene);

  return {
    harnesses: HARNESS_CATALOGUE.map((entry) => {
      const [status, version] = probes[entry.kind] ?? ["ready", entry.minVersion];

      return {
        harness: entry.kind,
        status,
        version,
        minVersion: entry.minVersion,
        signInKind: status === "ready" && entry.kind === "claude" ? "Claude Max" : null,
        detail: null,
        signInArgv: status === "not-installed" ? null : [...entry.setup.signInCommand],
      };
    }),
    checkedAt: "2026-09-30T00:00:00.000Z",
  };
};

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

const LIMITS = [
  new PlanLimit({
    harness: "claude",
    kind: "five-hour",
    scope: null,
    windowMinutes: 300,
    usedPercent: 42,
    status: "ok",
    resetsAt: later(130),
    observedAt: ago(1),
    plan: "max",
  }),
  new PlanLimit({
    harness: "claude",
    kind: "weekly",
    scope: null,
    windowMinutes: 10_080,
    usedPercent: 18,
    status: "ok",
    resetsAt: later(4 * 24 * 60),
    observedAt: ago(1),
    plan: "max",
  }),
];

const window_ = (
  harness: string,
  kind: string,
  scope: string | null,
  usedPercent: number,
  status: "ok" | "warning" = "ok"
) =>
  new PlanLimit({
    harness,
    kind,
    scope,
    windowMinutes: kind === "weekly" ? 10_080 : 300,
    usedPercent,
    status,
    resetsAt: later(kind === "weekly" ? 4 * 24 * 60 : 228),
    observedAt: ago(1),
    plan: harness === "claude" ? "max" : "pro",
    // The Daemon's typical 5-hour window, on Claude's whole-plan weekly.
    weeklyPerSession: harness === "claude" && kind === "weekly" && scope === null ? 14.6 : null,
  });

/**
 * Settings → Usage: Claude with two windows (Paper S2) or three (its model-scoped weekly), and
 * Codex. Forecasts: 5-hour in reserve, weekly in deficit (runs out), a near-limit run-out.
 */
const usageLimits = (scene: Scene) => [
  window_("claude", "five-hour", null, 16),
  window_("claude", "weekly", null, 62),
  ...(scene === "usage-3" ? [window_("claude", "weekly", "Fable", 92, "warning")] : []),
  window_("codex", "five-hour", null, 99.6, "warning"),
  window_("codex", "weekly", null, 0.4),
];

const isUsage = (scene: Scene) => scene === "usage-2" || scene === "usage-3";

/** The feeds the session view opens: availability and Plan Limits, sent once. */
const feed = (scene: Scene, kind: SubscriptionKind): ReadonlyArray<unknown> => {
  if (kind === "harness.availability") return [availability(scene)];

  if (kind === "usage" && isUsage(scene))
    return usageLimits(scene).map((limit) =>
      UsageStreamItem.cases.PlanLimitChanged.make({ limit })
    );

  return kind === "plan-limits" ? LIMITS : [];
};

const answer = (
  scene: Scene,
  method: RequestMethod,
  input: RequestInput<RequestMethod>
): Result<unknown> => {
  if (method === "harness.availability") return { ok: true, value: availability(scene) };

  if (method === "harness.models") {
    const harness = harnessOf(input);

    return {
      ok: true,
      value: { harness, models: MODELS[harness], switchesModel: true, fetchedAt: "" },
    };
  }

  if (method === "harness.commands") {
    return {
      ok: true,
      value: { harness: harnessOf(input), cwd: "", commands: COMMANDS, fetchedAt: "" },
    };
  }

  if (method === "git.diff")
    return { ok: true, value: { bytes: new TextEncoder().encode(PATCH), files: 3 } };

  if (method === "dispatch") return { ok: true, value: { sequence: null } };

  if (method === "usage.query") {
    return {
      ok: true,
      value: {
        report: { buckets: [], indexedAt: null, indexing: false },
        estimates: [],
        pricesFetchedAt: null,
      },
    };
  }

  return { ok: false, error: { code: "Unsupported", message: "preview" } };
};

const images = new Map<string, Promise<Result<unknown>>>();

/** One stand-in per size, so the preview's own drawing doesn't weigh on scroll measurements. */
const fixtureImage = (path: string): Promise<Result<unknown>> => {
  const key = path.includes("a1") ? "a1" : path.includes("a2") ? "a2" : "other";
  const known = images.get(key);

  if (known !== undefined) return known;
  const made = drawImage(path);

  images.set(key, made);

  return made;
};

/** A stand-in for a staged image: a gradient with its name, at the path's stored size. */
const drawImage = async (path: string): Promise<Result<unknown>> => {
  const [w, h] = path.includes("a1") ? [1440, 900] : path.includes("a2") ? [600, 800] : [800, 600];
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d");

  if (g !== null) {
    const fill = g.createLinearGradient(0, 0, w, h);

    fill.addColorStop(0, "#2a3350");
    fill.addColorStop(1, "#7b8bb8");
    g.fillStyle = fill;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f4f5f7";
    g.font = `${Math.round(h / 10)}px sans-serif`;
    g.fillText(path.split("/").at(-1) ?? "", w / 20, h / 2);
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());

  return {
    ok: true,
    value: { size: bytes.length, mimeType: "image/png", content: { kind: "bytes", bytes } },
  };
};

const bridgeFor = (scene: Scene): PolarisApi => ({
  // SAFETY: fixture answers match RequestOutputs for the methods the session feature calls.
  request: (method, input) =>
    (method === "files.read" && "path" in input && input.path.endsWith(".png")
      ? fixtureImage(input.path)
      : Promise.resolve(answer(scene, method, input))) as never,
  subscribe: (kind, _input, listener) => {
    // SAFETY: each fixture feed's items match SubscriptionItems for its kind.
    const items = feed(scene, kind) as never;
    const deliver = () => listener.items(items);

    if (feed(scene, kind).length > 0) queueMicrotask(deliver);

    return () => undefined;
  },
  onAppEvent: () => () => undefined,
});

const stateFor = (models: ReadonlyArray<SessionModel>): AppState => {
  return {
    ...initialState,
    hosts: [host],
    hostModels: {
      [HOST]: {
        ...modelFromSnapshot({
          sequence: Sequence.make(90),
          workspaces: [workspace],
          worktrees: [worktree],
          sessions: models.flatMap((m) =>
            m.session === null
              ? []
              : [
                  {
                    session: m.session,
                    pendingApprovals: m.pendingApprovals,
                    lastTurnPreview: m.turns.at(-1)?.turn.prompt ?? null,
                    subagents: [],
                  },
                ]
          ),
        }),
        synchronized: true,
      },
    },
    sessions: Object.fromEntries(
      models.flatMap((m) => (m.session === null ? [] : [[sessionKey(HOST, m.session.id), m]]))
    ),
  };
};

const sceneOf = (hash: string): Scene => {
  const name = hash.replace(/^#preview\//, "");

  return SCENE_NAMES.find((n) => n === name) ?? "session";
};

/**
 * Mounts the real shell on fixtures, with the scene's session (or the new-session page)
 * selected. Returns the density setter, for View → Density to reach the fixture store.
 */
export const mountPreview = (root: HTMLElement, hash: string) => {
  const scene = sceneOf(hash);
  const models = Object.values(SCENES).map((make) => make());
  const store = createStore<AppState>(() => stateFor(models));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });
  const isNew = scene === "new" || scene === "setup" || scene === "none-ready";
  const shown = isNew ? null : models[SCENE_NAMES.indexOf(scene)];

  standInBridge(bridgeFor(scene));

  if (shown?.session == null) {
    navigation.actions.selectWorkspace({ hostKey: HOST, workspaceId });
    navigation.actions.startNewSession();
  } else {
    navigation.actions.selectSession({ hostKey: HOST, sessionId: shown.session.id });
  }

  if (scene === "steer" && shown?.session != null) {
    const key = uiKey(HOST, shown.session.id);
    const turnId = shown.turns.at(-1)?.turn.id ?? "";

    patchSessionUi(key, () => ({ outbox: steerOutbox(turnId) }));
  }

  if (scene === "attachments" && shown?.session != null) {
    const unfolded = new Set(shown.turns.map((t) => t.turn.id));

    patchSessionUi(uiKey(HOST, shown.session.id), () => ({ unfolded }));
  }

  // The long scene opens every Turn, so scrolling crosses thousands of rows.
  if (scene === "long" && shown?.session != null) {
    const unfolded = new Set(shown.turns.map((t) => t.turn.id));

    patchSessionUi(uiKey(HOST, shown.session.id), () => ({ unfolded }));
  }

  if (isUsage(scene)) navigation.actions.openSettings("usage");

  const commands = createCommandRegistry({ mac: true });

  createRoot(root).render(<App value={{ connection, navigation, commands }} />);

  return connection.setDensity;
};
