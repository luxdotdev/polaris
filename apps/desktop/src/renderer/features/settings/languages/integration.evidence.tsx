import "../../../styles.css";
import * as P from "@polaris/protocol";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { standInBridge } from "../../bridge.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { initialState, type AppState, type Connection } from "../../../store/store.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { SettingsPage } from "../ui/SettingsPage.tsx";
import { createIntegrationFixture } from "./integration.fixture.ts";
import { refreshMarkdownPolicy } from "../../editor/runtime/actions.ts";
import { editorStore } from "../../editor/runtime/store.ts";
import { workspaceKey } from "../../editor/model/drafts.ts";
import { setLanguageSettingsServices } from "./services.ts";

const fixture = createIntegrationFixture();

const checkout = fixture.discovery.checkout;

const workspace = P.Workspace.make({
  id: checkout.workspaceId,
  path: "/fixture",
  name: "lucas/eng-169-research-herdr-dagrs-dag-model-with-a-very-long-workspace-name",
  isGitRepo: true,
  worktreeRoot: "/fixture/worktrees",
  hidden: false,
  worktreeSetup: null,
  registeredAt: "2026-10-02",
});

const worktree = P.Worktree.make({
  id: P.WorktreeId.make("fake-worktree"),
  workspaceId: workspace.id,
  path: checkout.path,
  branch: workspace.name,
  head: "fake",
  createdBySessionId: null,
  isMain: false,
});

const store = createStore<AppState>(() => ({
  ...initialState,
  hosts: [fixture.host],
  hostModels: {
    [fixture.host.key]: {
      ...emptyHostModel,
      synchronized: true,
      workspaces: new Map([[workspace.id, workspace]]),
      worktrees: new Map([[worktree.id, worktree]]),
    },
  },
}));

const navigation = createNavigation({ app: store, storage: null });

navigation.actions.openSettings("editor");

const connection: Connection = {
  store,
  openSession: () => () => {},
  setAppearance: () => {},
  setDensity: () => {},
};

standInBridge({
  languages: fixture.api,
  request: async () => ({ ok: false, error: { code: "Fixture", message: "No live services" } }),
  subscribe: () => () => {},
  onAppEvent: () => () => {},
});

const refreshes: Array<string> = [];

setLanguageSettingsServices({
  refreshMarkdownPolicy: (host, ws) => {
    refreshes.push(`${host}:${ws}`);
    refreshMarkdownPolicy(host, ws);
  },
});

editorStore.setState({
  previewEpochs: {
    [workspaceKey("unrelated-host", workspace.id)]: 7,
    [workspaceKey(fixture.host.key, "unrelated-workspace")]: 11,
  },
});

Object.assign(window, {
  integrationFixture: {
    ...fixture,
    refreshes,
    previewEpochs: () => editorStore.getState().previewEpochs,
    disconnect: () =>
      store.setState({
        hosts: [
          { ...fixture.host, status: { ...fixture.host.status, state: "offline", epoch: 2 } },
        ],
      }),
    reconnect: () =>
      store.setState({
        hosts: [{ ...fixture.host, status: { ...fixture.host.status, epoch: 3 } }],
      }),
  },
});

const Evidence = () => {
  const route = useStore(navigation.store, (s) => s.settings);

  return (
    <AppProvider value={{ connection, navigation, commands: createCommandRegistry({ mac: true }) }}>
      {route ? <SettingsPage route={route} /> : <p>Settings closed</p>}
    </AppProvider>
  );
};

const root = document.getElementById("root");

if (root) createRoot(root).render(<Evidence />);
