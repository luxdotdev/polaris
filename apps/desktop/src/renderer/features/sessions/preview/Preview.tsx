/**
 * The shell's Constellation parts on fixtures (C1-U2), for screenshots against Paper C1–C5:
 * `#constellations/<scene>` renders the real shell on a stand-in store. Scenes: `sidebar`
 * (C1, the Lead selected), `focus` (C3, B1 focused), `needs-you` (C5), `review` (C4, B1's claim), and
 * Settings' `defaults`, `hosts` (open a host row) and `usage` (By Constellation).
 */
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { PolarisApi } from "../../../../shared/api.ts";
import { App } from "../../../app/App.tsx";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { focusTask } from "../../constellation/hooks.ts";
import { modelsFromViews } from "../../constellation/model/fold.ts";
import { openSessionReview } from "../../../routes/review.ts";
import type { SettingsSection } from "../../../routes/selection.ts";
import { machinesFor } from "../../machines/preview/fixtures.ts";
import { setResourcesClient } from "../../settings/resources.ts";
import { fakeResources, USAGE } from "./settingsFixtures.ts";
import { C1, HOSTS, LEAD_SESSION, MODELS, VIEWS, WORKER_B1 } from "./fixtures.ts";

const UNSUPPORTED = { ok: false, error: { code: "Unsupported", message: "preview" } } as const;

const bridge: PolarisApi = {
  request: (method, input) =>
    // SAFETY: each answer is the output type of the method it answers; Usage is on this Mac only.
    Promise.resolve(
      (method === "usage.query" && "hostKey" in input && input.hostKey === "local"
        ? { ok: true, value: USAGE }
        : UNSUPPORTED) as never
    ),
  subscribe: (kind, _input, listener) => {
    const machines = [machinesFor("all", Date.now())];

    if (kind === "machines") {
      // SAFETY: only the machines feed is answered, and its items are machine lists.
      listener.items(machines as never);
    }

    return () => undefined;
  },
  onAppEvent: () => () => undefined,
};

const SETTINGS = new Map<string, SettingsSection>([
  ["defaults", "constellations"],
  ["hosts", "hosts"],
  ["usage", "usage"],
]);

export const mountConstellationsPreview = (root: HTMLElement, hash: string) => {
  const scene = hash.replace(/^#constellations\//, "");

  const store = createStore<AppState>(() => ({
    ...initialState,
    hosts: HOSTS,
    hostModels: MODELS,
    constellations: modelsFromViews(VIEWS),
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });

  standInBridge(bridge);
  setResourcesClient(fakeResources);
  navigation.actions.selectSession(LEAD_SESSION);

  if (scene === "focus") {
    const b1 = C1.constellation.tasks.find((t) => t.id === "B1");

    if (b1 !== undefined)
      focusTask({ hostKey: "local", leadSessionId: LEAD_SESSION.sessionId, taskId: b1.id });
  }

  if (scene === "needs-you") navigation.actions.showSidebar("needs-you");

  if (scene === "review")
    openSessionReview(navigation.actions, WORKER_B1.hostKey, WORKER_B1.sessionId);

  const section = SETTINGS.get(scene);

  if (section !== undefined) navigation.actions.openSettings(section);

  const commands = createCommandRegistry({ mac: true });

  createRoot(root).render(<App value={{ connection, navigation, commands }} />);

  return connection.setDensity;
};
