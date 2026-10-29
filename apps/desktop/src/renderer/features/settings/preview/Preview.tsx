/**
 * `#settings/<scene>`: Settings in the real shell on worst-case fixtures (the break-UI pass,
 * ENG-499). Scenes: `usage-heavy` (four Harnesses, eighteen Models, billions of tokens, plan
 * limits past their window), `usage-one` (one token), `usage-empty`, `usage-none` (no Host reports
 * Usage) and `appearance`. Its own chunk.
 */
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { HostView, PolarisApi, UsageQueryView } from "../../../../shared/api.ts";
import { App } from "../../../app/App.tsx";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import type { SettingsSection } from "../../../routes/selection.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { HOSTS as NEEDS_YOU_HOSTS } from "../../needs-you/preview/fixtures.ts";
import { EMPTY, HEAVY, LIMITS, ONE } from "./fixtures.ts";

const UNSUPPORTED = { ok: false, error: { code: "Unsupported", message: "preview" } } as const;

const USAGE = new Map<string, UsageQueryView | null>([
  ["usage-heavy", HEAVY],
  ["usage-one", ONE],
  ["usage-empty", EMPTY],
  ["usage-none", null],
]);

const host = (): HostView => {
  const base = NEEDS_YOU_HOSTS[0];

  if (base === undefined) throw new Error("needs-you fixtures have no Host");

  return base;
};

const bridge = (usage: UsageQueryView | null, heavy: boolean): PolarisApi => ({
  // SAFETY: usage.query is the only answered method, with its output type.
  request: (method) =>
    Promise.resolve(
      (method === "usage.query" && usage !== null
        ? { ok: true, value: usage }
        : UNSUPPORTED) as never
    ),
  subscribe: (kind, _input, listener) => {
    if (kind === "usage" && heavy) {
      // SAFETY: only the usage feed is answered, and its items are Usage stream items.
      listener.items(LIMITS as never);
    }

    return () => undefined;
  },
  onAppEvent: () => () => undefined,
});

export const mountSettingsPreview = (root: HTMLElement, hash: string) => {
  const scene = hash.replace(/^#settings\//, "");
  const usage = USAGE.get(scene) ?? null;
  const base = host();

  // No Host reports Usage: the one Host lacks the capability.
  const hosts: ReadonlyArray<HostView> =
    scene === "usage-none" ? [{ ...base, status: { ...base.status, capabilities: [] } }] : [base];

  const store = createStore<AppState>(() => ({ ...initialState, hosts }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });
  const section: SettingsSection = scene === "appearance" ? "appearance" : "usage";

  standInBridge(bridge(usage, scene === "usage-heavy"));
  navigation.actions.openSettings(section);

  createRoot(root).render(
    <App value={{ connection, navigation, commands: createCommandRegistry({ platform: "mac" }) }} />
  );

  return connection.setDensity;
};
