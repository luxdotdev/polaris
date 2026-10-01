/**
 * Pull requests on fixtures, for screenshots against Paper R3 (7LH-0): `#pulls/list`,
 * `#pulls/signed-out`, `#pulls/empty`, and `#pulls/reviews` (Needs You's Reviews group).
 */
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { PolarisApi, SubscriptionItem, SubscriptionKind } from "../../../../shared/api.ts";
import { App } from "../../../app/App.tsx";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { ACCOUNTS, EMPTY_LIST, HOSTS, LIST, MODELS, SIGNED_OUT } from "./fixtures.ts";

type Feeds = { readonly [K in SubscriptionKind]?: SubscriptionItem<K> };

const feeds = (scene: string): Feeds => ({
  "github.pulls": scene === "empty" || scene === "signed-out" ? EMPTY_LIST : LIST,
  "github.accounts": scene === "signed-out" ? SIGNED_OUT : ACCOUNTS,
});

const bridgeFor = (scene: string): PolarisApi => ({
  request: () => Promise.resolve({ ok: false, error: { code: "Unsupported", message: "preview" } }),
  subscribe: (kind, _input, listener) => {
    const item = feeds(scene)[kind];

    if (item !== undefined) queueMicrotask(() => listener.items([item]));

    return () => undefined;
  },
  onAppEvent: () => () => undefined,
});

export const mountPullsPreview = (root: HTMLElement, hash: string) => {
  const scene = hash.replace(/^#pulls\//, "");

  const store = createStore<AppState>(() => ({
    ...initialState,
    hosts: HOSTS,
    hostModels: MODELS,
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });

  standInBridge(bridgeFor(scene));

  if (scene === "reviews") {
    navigation.actions.selectHost("studio");
    navigation.actions.showSidebar("needs-you");
  } else navigation.actions.setMode("review");

  const commands = createCommandRegistry({ mac: true });

  createRoot(root).render(<App value={{ connection, navigation, commands }} />);

  return connection.setDensity;
};
