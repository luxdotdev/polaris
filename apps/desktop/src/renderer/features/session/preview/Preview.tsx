/**
 * The session view on fixtures, for screenshots against Paper
 * (`scripts/sessionScreens.ts`): `#preview/<scene>` renders the shell with one
 * scene selected, on a stand-in bridge and store, no Daemon involved. Its own chunk.
 */
import { Capability, HARNESS_CATALOGUE, HostId, Sequence } from "@polaris/protocol";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type {
  HostView,
  PolarisApi,
  RequestInput,
  RequestMethod,
  Result,
} from "../../../../shared/api.ts";
import { modelFromSnapshot } from "../../../store/hostModel.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { App } from "../../../app/App.tsx";
import { createNavigation } from "../../../routes/navigation.ts";
import { type AppState, type Connection, initialState, sessionKey } from "../../../store/store.ts";
import { standInBridge } from "../bridge.ts";
import { patchSessionUi, uiKey } from "../state.ts";
import {
  approval,
  interrupted,
  long,
  MODELS,
  PATCH,
  planning,
  question,
  workspace,
  workspaceId,
  worktree,
} from "./fixtures.ts";

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
  },
};

const SCENES = { session: planning, approval, question, interrupted, long } as const;

const SCENE_NAMES = [
  "session",
  "approval",
  "question",
  "interrupted",
  "long",
  "new",
  "setup",
] as const;

type Scene = (typeof SCENE_NAMES)[number];

const harnessOf = (input: RequestInput<RequestMethod>) =>
  "harness" in input && input.harness === "codex" ? "codex" : "claude";

/** Every catalogue Harness ready, except Codex on the setup scene. */
const availability = (scene: Scene) => ({
  harnesses: HARNESS_CATALOGUE.map((entry) => ({
    harness: entry.kind,
    status: scene === "setup" && entry.kind === "codex" ? "not-installed" : "ready",
    version: scene === "setup" && entry.kind === "codex" ? null : entry.minVersion,
    minVersion: entry.minVersion,
    detail: null,
    signInArgv: null,
  })),
  checkedAt: "2026-09-30T00:00:00.000Z",
});

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

  if (method === "git.diff")
    return { ok: true, value: { bytes: new TextEncoder().encode(PATCH), files: 3 } };

  if (method === "dispatch") return { ok: true, value: { sequence: null } };

  return { ok: false, error: { code: "Unsupported", message: "preview" } };
};

const bridgeFor = (scene: Scene): PolarisApi => ({
  // SAFETY: fixture answers match RequestOutputs for the methods the session feature calls.
  request: (method, input) => Promise.resolve(answer(scene, method, input) as never),
  subscribe: () => () => undefined,
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
  };

  const navigation = createNavigation({ app: store, storage: null });
  const shown = scene === "new" || scene === "setup" ? null : models[SCENE_NAMES.indexOf(scene)];

  standInBridge(bridgeFor(scene));

  if (shown?.session == null) {
    navigation.actions.selectWorkspace({ hostKey: HOST, workspaceId });
    navigation.actions.startNewSession();
  } else {
    navigation.actions.selectSession({ hostKey: HOST, sessionId: shown.session.id });
  }

  // The long scene opens every Turn, so scrolling crosses thousands of rows.
  if (scene === "long" && shown?.session != null) {
    const unfolded = new Set(shown.turns.map((t) => t.turn.id));

    patchSessionUi(uiKey(HOST, shown.session.id), () => ({ unfolded }));
  }

  createRoot(root).render(<App value={{ connection, navigation }} />);

  return connection.setDensity;
};
