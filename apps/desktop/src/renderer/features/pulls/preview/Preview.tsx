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
import { riskStore } from "../../risk/data/riskStore.ts";
import {
  ACCOUNTS,
  EMPTY_LIST,
  HOSTS,
  LIST,
  MODELS,
  ORCHESTRATOR_KEY,
  RISK,
  SIGNED_OUT,
} from "./fixtures.ts";

type Feeds = { readonly [K in SubscriptionKind]?: SubscriptionItem<K> };

const feeds = (scene: string): Feeds => ({
  "github.pulls": scene === "empty" || scene === "signed-out" ? EMPTY_LIST : LIST,
  "github.accounts": scene === "signed-out" ? SIGNED_OUT : ACCOUNTS,
});

const UNSUPPORTED = { ok: false, error: { code: "Unsupported", message: "preview" } } as const;

const bridgeFor = (scene: string): PolarisApi => ({
  request: (method) =>
    // SAFETY: the list's risk lane reads only a summary's status and its findings' severity and status.
    Promise.resolve(
      method === "review.riskSummary" ? ({ ok: true, value: RISK.pull88 } as never) : UNSUPPORTED
    ),
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
  // SAFETY: summaries this window would follow from an open Review; the lane reads only status and findings.
  const followed = { session: RISK.session as never, mine: RISK.mine212 as never };

  riskStore.setState({
    [ORCHESTRATOR_KEY]: { kind: "ready", hostKey: "studio", summary: followed.session },
    "pull:lucasdoell/polaris#212": { kind: "ready", hostKey: "local", summary: followed.mine },
  });

  if (scene === "reviews") {
    navigation.actions.selectHost("studio");
    navigation.actions.showSidebar("needs-you");
  } else navigation.actions.setMode("review");

  const commands = createCommandRegistry({ mac: true });

  createRoot(root).render(<App value={{ connection, navigation, commands }} />);

  return connection.setDensity;
};
