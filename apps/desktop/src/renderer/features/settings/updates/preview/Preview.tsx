/** About on fixture Updates: every reachable phase and a fake-only interactive flow. */
import { Schema } from "effect";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { AppEvent, PolarisApi } from "../../../../../shared/api.ts";
import type { AppUpdateView } from "../../../../../shared/appUpdates.ts";
import { App } from "../../../../app/App.tsx";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../../../../store/store.ts";
import { standInBridge } from "../../../bridge.ts";
import { settingsCommands } from "../../actions.ts";
import { connectUpdates, updatesStore } from "../store.ts";

const PHASES: ReadonlyArray<AppUpdateView["phase"]> = [
  "idle",
  "checking",
  "current",
  "downloading",
  "ready",
  "blocked",
  "failed",
];

const Enabled = Schema.Struct({ enabled: Schema.Boolean });

const fixtureBridge = (hash: string): PolarisApi => {
  const scene = hash.replace(/^#updates\//, "");

  let view: AppUpdateView = {
    phase: PHASES.find((phase) => phase === scene) ?? "idle",
    version: "0.4.0",
    availableVersion: scene === "ready" ? "0.5.0" : null,
    automatic: scene !== "off",
    lastCheckedAt: Date.now() - 2 * 60 * 60_000,
    installId: "58baf1dc-3772-4353-86b3-3a8a49219521",
    macOSVersion: "26.1",
    arch: "arm64",
    supported: true,
  };

  const listeners = new Set<(event: AppEvent) => void>();

  const publish = (patch: Partial<AppUpdateView>) => {
    view = { ...view, ...patch };

    for (const listener of listeners) listener({ kind: "updates", updates: view });
  };

  return {
    request: async (method, input) => {
      let value: AppUpdateView | null = null;

      switch (method) {
        case "updates.get":
          value = view;
          break;
        case "updates.setAutomatic":
          publish({ automatic: Schema.decodeUnknownSync(Enabled)(input).enabled });
          value = view;
          break;
        case "updates.check":
          publish({ phase: "checking" });
          setTimeout(() => publish({ phase: "downloading" }), 250);
          setTimeout(
            () => publish({ phase: "ready", availableVersion: "0.5.0", lastCheckedAt: Date.now() }),
            500
          );
          value = view;
          break;
        case "updates.restart":
          publish({
            phase: "current",
            version: view.availableVersion ?? view.version,
            availableVersion: null,
          });
          break;
        case "updates.showInFinder":
          break;
        default:
          return { ok: false, error: { code: "Unsupported", message: "preview" } };
      }
      // SAFETY: each handled fixture method returns its documented view or null output.

      return { ok: true, value: value as never };
    },
    subscribe: () => () => undefined,
    onAppEvent: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};

export const mountUpdatesPreview = (root: HTMLElement, hash: string) => {
  const store = createStore<AppState>(() => initialState);

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });
  const api = fixtureBridge(hash);
  standInBridge(api);
  updatesStore.setState({ view: null, problem: null });
  connectUpdates(api);
  navigation.actions.openSettings("about");
  const commands = createCommandRegistry({ mac: true });
  commands.register(settingsCommands(navigation.actions));
  createRoot(root).render(<App value={{ connection, navigation, commands }} />);

  return connection.setDensity;
};
