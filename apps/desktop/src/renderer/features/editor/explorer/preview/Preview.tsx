/**
 * Edit mode on fixtures, for screenshots against Paper E1: `#explorer/<scene>`
 * renders the real shell in Edit on a stand-in store and bridge. Its own chunk.
 */
import { Capability, HostId, Sequence } from "@polaris/protocol";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { HostView, PolarisApi } from "../../../../../shared/api.ts";
import { App } from "../../../../app/App.tsx";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { modelFromSnapshot } from "../../../../store/hostModel.ts";
import {
  type AppState,
  type Connection,
  initialState,
  sessionKey,
} from "../../../../store/store.ts";
import { standInBridge } from "../../../bridge.ts";
import { startDraft } from "../data/actions.ts";
import { explorerKey, patchExplorer } from "../data/store.ts";
import { openFile } from "../editorSeam.tsx";
import {
  CHECKOUT,
  HOME,
  listing,
  PLANNING,
  planning,
  planningModel,
  ROOT,
  SPIKE,
  spike,
  spikeApproval,
  spikeModel,
  STATUS,
  WORKSPACE,
  workspace,
} from "./fixtures.ts";

const LOCAL = "local";

const SCENES = ["files", "changes", "draft", "no-git", "remote", "checkout"] as const;

type Scene = (typeof SCENES)[number];

const host = (scene: Scene): HostView => ({
  key: LOCAL,
  label: scene === "remote" ? "Linux VM" : "Mac Studio",
  colour: null,
  alias: scene === "remote" ? "linux-vm" : null,
  proofHarness: false,
  status: {
    state: scene === "remote" ? "reconnecting" : "connected",
    failure: null,
    attempt: 0,
    since: Date.now() - 12_000,
    nextAttemptAt: null,
    host: {
      hostId: HostId.make("studio"),
      hostname: "studio",
      platform: "darwin-arm64",
      daemonVersion: "0.0.0",
      homeDir: HOME,
      startedAt: "2026-09-29T00:00:00.000Z",
    },
    capabilities: Capability.literals,
    epoch: 1,
    latencyMs: scene === "remote" ? 84 : null,
    lastSeenAt: null,
  },
});

const stateFor = (scene: Scene): AppState => ({
  ...initialState,
  hosts: [host(scene)],
  hostModels: {
    [LOCAL]: {
      ...modelFromSnapshot({
        sequence: Sequence.make(40),
        workspaces: [workspace],
        worktrees: [],
        sessions: [
          {
            session: spike,
            pendingApprovals: [spikeApproval],
            lastTurnPreview: null,
            subagents: [],
          },
          { session: planning, pendingApprovals: [], lastTurnPreview: null, subagents: [] },
        ],
      }),
      synchronized: true,
    },
  },
  sessions: {
    [sessionKey(LOCAL, SPIKE)]: spikeModel,
    [sessionKey(LOCAL, PLANNING)]: planningModel,
  },
});

const ok = <A,>(value: A) => Promise.resolve({ ok: true as const, value });

const refuse = (code: string) =>
  Promise.resolve({ ok: false as const, error: { code, message: "preview" } });

const bridgeFor = (scene: Scene): PolarisApi => ({
  // SAFETY: each answer is the output type of the method it answers.
  request: ((method: string, input: { path?: string; cwd?: string }) => {
    if (method === "files.listDir") {
      const entries = listing(input.path ?? "");

      return entries === undefined ? refuse("FileError") : ok(entries);
    }

    if (method === "files.stat") {
      const git =
        scene !== "no-git" && (input.path === `${ROOT}/.git` || input.path === `${CHECKOUT}/.git`);

      return git
        ? ok({ name: ".git", path: input.path, kind: "directory", size: 0, modifiedAt: "" })
        : refuse("FileError");
    }

    if (method === "git.status")
      return ok(input.cwd === CHECKOUT ? { ...STATUS, entries: [] } : STATUS);

    return refuse("Unsupported");
  }) as PolarisApi["request"],
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
});

const KEY = explorerKey(LOCAL, WORKSPACE);

const prepare = (scene: Scene) => {
  patchExplorer(KEY, () => ({
    view: scene === "changes" ? "changes" : "files",
    root: scene === "checkout" ? CHECKOUT : null,
    expanded: new Set([
      `${ROOT}/daemon`,
      `${ROOT}/daemon/src`,
      `${ROOT}/daemon/src/hosts`,
      `${ROOT}/desktop`,
      `${ROOT}/desktop/src`,
    ]),
  }));

  for (const path of [
    "daemon/src/hosts/reconnect.ts",
    "daemon/src/hosts/transport.ts",
    "CONTEXT.md",
  ]) {
    openFile({ hostKey: LOCAL, workspaceId: WORKSPACE, path: `${ROOT}/${path}` });
  }

  openFile({
    hostKey: LOCAL,
    workspaceId: WORKSPACE,
    path: `${ROOT}/daemon/src/hosts/reconnect.ts`,
  });

  if (scene === "draft")
    startDraft(KEY, { kind: "create", dir: `${ROOT}/daemon/src/hosts`, entry: "file" });
};

const sceneOf = (hash: string): Scene => {
  const name = hash.replace(/^#explorer\//, "");

  return SCENES.find((s) => s === name) ?? "files";
};

export const mountExplorerPreview = (root: HTMLElement, hash: string) => {
  const scene = sceneOf(hash);
  const store = createStore<AppState>(() => stateFor(scene));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });

  standInBridge(bridgeFor(scene));
  prepare(scene);
  navigation.actions.selectWorkspace({ hostKey: LOCAL, workspaceId: WORKSPACE });
  navigation.actions.setMode("edit");

  createRoot(root).render(
    <App value={{ connection, navigation, commands: createCommandRegistry({ mac: true }) }} />
  );

  return connection.setDensity;
};
