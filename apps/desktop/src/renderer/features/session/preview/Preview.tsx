/**
 * The session view on fixtures, for screenshots against Paper
 * (`scripts/sessionScreens.ts`): `#preview/<scene>` renders one scene with a
 * stand-in bridge and store, no Daemon involved. Loaded as its own chunk.
 */
import { Capability, HostId, type SessionId, Sequence } from "@polaris/protocol";
import type { ReactNode } from "react";
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
import { type AppState, initialState, sessionKey } from "../../../store/store.ts";
import { ConnectionProvider } from "../../../views/hooks.ts";
import { standInBridge } from "../bridge.ts";
import { patchSessionUi, uiKey } from "../state.ts";
import { NewSessionPage } from "../ui/NewSessionPage.tsx";
import { SessionView } from "../ui/SessionView.tsx";
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

const SCENE_NAMES = ["session", "approval", "question", "interrupted", "long", "new"] as const;

type Scene = (typeof SCENE_NAMES)[number];

const harnessOf = (input: RequestInput<RequestMethod>) =>
  "harness" in input && input.harness === "codex" ? "codex" : "claude";

const answer = (method: RequestMethod, input: RequestInput<RequestMethod>): Result<unknown> => {
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

const bridge: PolarisApi = {
  // SAFETY: fixture answers match RequestOutputs for the methods the session feature calls.
  request: (method, input) => Promise.resolve(answer(method, input) as never),
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
};

const stateFor = (models: ReadonlyArray<SessionModel>): AppState => {
  const sessions = models.flatMap((m) => (m.session === null ? [] : [m.session]));

  return {
    ...initialState,
    hosts: [host],
    hostModels: {
      [HOST]: {
        ...modelFromSnapshot({
          sequence: Sequence.make(90),
          workspaces: [workspace],
          worktrees: [worktree],
          sessions: sessions.map((session) => ({
            session,
            pendingApprovals: [],
            lastTurnPreview: null,
          })),
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

/** Stands in for the shell's chrome: title bar, Workspace bar and the Input column. */
const Chrome = ({ children }: { readonly children: ReactNode }) => (
  <div className="bg-bg flex h-full flex-col">
    <div className="border-hairline bg-surface-sunken h-[84px] shrink-0 border-b" />
    <div className="flex min-h-0 flex-1">
      <div className="border-hairline bg-surface-sunken w-[264px] shrink-0 border-r" />
      {children}
    </div>
  </div>
);

export const Preview = ({ hash }: { readonly hash: string }) => {
  const scene = sceneOf(hash);
  const models = Object.values(SCENES).map((make) => make());
  const store = createStore<AppState>(() => stateFor(models));
  const shown = scene === "new" ? null : models[SCENE_NAMES.indexOf(scene)];
  const sessionId: SessionId | null = shown?.session?.id ?? null;

  standInBridge(bridge);

  // The long scene opens every Turn, so scrolling crosses thousands of rows.
  if (scene === "long" && shown?.session != null) {
    const unfolded = new Set(shown.turns.map((t) => t.turn.id));

    patchSessionUi(uiKey(HOST, shown.session.id), () => ({ unfolded }));
  }

  return (
    <ConnectionProvider
      value={{ store, openSession: () => () => undefined, setRoute: () => undefined }}
    >
      <Chrome>
        {sessionId === null ? (
          <NewSessionPage hostKey={HOST} workspaceId={workspaceId} onStarted={() => undefined} />
        ) : (
          <SessionView hostKey={HOST} sessionId={sessionId} />
        )}
      </Chrome>
    </ConnectionProvider>
  );
};
