import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { applyAppearance } from "./appearance.ts";
import {
  connectSettings,
  registerSettingsActions,
  settingsStore,
} from "./features/settings/index.ts";
import { startProofSession } from "./proof.ts";
import { installKeyboard } from "./routes/keyboard.ts";
import { createNavigation } from "./routes/navigation.ts";
import { exposeSwitchTimes } from "./routes/switchTimer.ts";
import type { Appearance, Density } from "../shared/api.ts";
import { connect } from "./store/store.ts";

const connection = connect(window.polaris);

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

const navigation = createNavigation({ app: connection.store, storage });

// `#preview/<scene>`: the shell on fixtures, for screenshots (features/session/preview).
const preview = location.hash.startsWith("#preview/");

let setPreviewDensity: ((density: Density) => void) | null = null;

const appearance = (value: Appearance) => {
  applyAppearance(value);
  connection.setDensity(value.density);
  setPreviewDensity?.(value.density);
};

appearance(settingsStore.getState().appearance);

settingsStore.subscribe((state, prev) => {
  if (state.appearance !== prev.appearance) appearance(state.appearance);
});

connectSettings(window.polaris);

window.polaris.onAppEvent((event) => {
  if (event.kind === "route") navigation.actions.setMode(event.route);
  else if (event.kind === "settings") navigation.actions.openSettings();
  else if (event.kind === "proof") {
    void startProofSession({ api: window.polaris, store: connection.store, hostKey: event.hostKey })
      .then((sessionId) => navigation.actions.selectSession({ hostKey: event.hostKey, sessionId }))
      .catch((cause: unknown) => console.error("polaris: proof session failed", cause));
  }
});

installKeyboard(navigation.actions);

registerSettingsActions(navigation.actions);

exposeSwitchTimes();

const root = document.getElementById("root");

if (root !== null && preview) {
  void import("./features/session/preview/Preview.tsx").then((m) => {
    setPreviewDensity = m.mountPreview(root, location.hash);
  });
} else if (root !== null) {
  createRoot(root).render(<App value={{ connection, navigation }} />);
}
