/** About on fixture Updates: every reachable phase and a fake-only interactive flow. */
import { DeveloperMode, WorkspaceId } from "@polaris/protocol";
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
import { HOSTS, MODELS } from "../../../needs-you/preview/fixtures.ts";
import { hostDeveloperModesStore } from "../../hostDeveloperModes.ts";
import { settingsStore } from "../../store.ts";

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

/** `#updates/developer` and `#updates/developer-dev`: About's Developer Mode on three Hosts. */
const DEVELOPER_SCENES = new Set(["developer", "developer-dev"]);

const developerMode = (stored: boolean, leases: number, workspace: string | null) =>
  DeveloperMode.make({
    stored,
    leases,
    fromSource: false,
    effective: stored || leases > 0,
    polarisWorkspaceId: workspace === null ? null : WorkspaceId.make(workspace),
    polarisWorkspaceSource: workspace === null ? null : "remote",
  });

const developerModes = (dev: boolean) => ({
  local: developerMode(false, dev ? 1 : 0, "w-polaris"),
  "linux-vm": developerMode(false, dev ? 1 : 0, null),
  pi: developerMode(false, dev ? 1 : 0, null),
});

const MB = 1_000_000;

/** Paper U1's figures: 48 of 131 MB. */
const DOWNLOAD = { version: "0.5.0", receivedBytes: 48 * MB, totalBytes: 131 * MB };

/** `#updates/failed-download` and `#updates/failed-verify`: the two ways a download fails. */
const FAILURES = new Map<string, AppUpdateView["failure"]>([
  ["failed", { stage: "check", version: null, percent: null }],
  ["failed-download", { stage: "download", version: "0.5.0", percent: 61 }],
  ["failed-verify", { stage: "verify", version: "0.5.0", percent: null }],
  ["failed-install", { stage: "install", version: "0.5.0", percent: null }],
]);

const fixtureBridge = (hash: string): PolarisApi => {
  const scene = hash.replace(/^#updates\//, "");
  const failure = FAILURES.get(scene) ?? null;

  let view: AppUpdateView = {
    phase: failure === null ? (PHASES.find((phase) => phase === scene) ?? "idle") : "failed",
    version: "0.4.0",
    availableVersion: ["ready", "downloading"].includes(scene) ? "0.5.0" : null,
    readyVersion: scene === "ready" ? "0.5.0" : null,
    download: scene === "downloading" ? DOWNLOAD : null,
    failure,
    automatic: scene !== "off",
    lastCheckedAt: Date.now() - 2 * 60 * 60_000,
    installId: "58baf1dc-3772-4353-86b3-3a8a49219521",
    osVersion: "26.1",
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
          publish({ phase: "checking", failure: null });

          // A fake download in ten steps, so the bar can be watched moving.
          for (let step = 0; step <= 10; step++)
            setTimeout(
              () =>
                publish({
                  phase: "downloading",
                  availableVersion: "0.5.0",
                  download: { ...DOWNLOAD, receivedBytes: step * 13.1 * MB },
                }),
              250 + step * 300
            );
          setTimeout(
            () =>
              publish({
                phase: "ready",
                readyVersion: "0.5.0",
                download: null,
                lastCheckedAt: Date.now(),
              }),
            3800
          );
          value = view;
          break;
        case "updates.restart":
          publish({
            phase: "current",
            version: view.readyVersion ?? view.version,
            availableVersion: null,
            readyVersion: null,
          });
          break;
        case "updates.showInFinder":
          break;
        case "developerMode.get":
        case "developerMode.set":
        case "developerMode.setWorkspace": {
          const { hostKey } = Schema.decodeUnknownSync(Schema.Struct({ hostKey: Schema.String }))(
            input
          );
          // SAFETY: the developerMode methods answer a DeveloperMode.

          return { ok: true, value: developerModes(false)[hostKey as "local"] as never };
        }

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
  const scene = hash.replace(/^#updates\//, "");
  const developer = DEVELOPER_SCENES.has(scene);

  const store = createStore<AppState>(() =>
    developer ? { ...initialState, hosts: HOSTS, hostModels: MODELS } : initialState
  );

  if (developer) {
    settingsStore.setState({ developmentBuild: scene === "developer-dev" });
    hostDeveloperModesStore.setState(developerModes(scene === "developer-dev"), true);
  }

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
  const commands = createCommandRegistry({ platform: "mac" });
  commands.register(settingsCommands(navigation.actions));
  createRoot(root).render(<App value={{ connection, navigation, commands }} />);

  return connection.setDensity;
};
