/**
 * Needs You on fixtures, for screenshots against Paper 1G2-0 (the inbox) and 1-0 (the hover
 * card): `#needs-you/inbox` or `#needs-you/hover` renders the real shell on a stand-in store.
 */
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { PolarisApi } from "../../../../shared/api.ts";
import { App } from "../../../app/App.tsx";
import { createNavigation } from "../../../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { standInBridge } from "../../session/bridge.ts";
import { APPROVAL, HOSTS, MODELS, QUESTION } from "./fixtures.ts";

const bridge: PolarisApi = {
  request: () => Promise.resolve({ ok: false, error: { code: "Unsupported", message: "preview" } }),
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
};

export const mountNeedsYouPreview = (root: HTMLElement, hash: string) => {
  const scene = hash.replace(/^#needs-you\//, "");

  const store = createStore<AppState>(() => ({
    ...initialState,
    hosts: HOSTS,
    hostModels: MODELS,
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
  };

  const navigation = createNavigation({ app: store, storage: null });

  standInBridge(bridge);

  if (scene === "hover") {
    navigation.actions.selectSession({ hostKey: APPROVAL.hostKey, sessionId: APPROVAL.sessionId });
  } else {
    navigation.actions.selectSession({ hostKey: QUESTION.hostKey, sessionId: QUESTION.sessionId });
    navigation.actions.showSidebar("needs-you");
  }

  createRoot(root).render(<App value={{ connection, navigation }} />);

  return connection.setDensity;
};
