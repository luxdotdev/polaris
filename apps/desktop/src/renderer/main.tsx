import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { applyAppearance } from "./appearance.ts";
import { startProofSession } from "./proof.ts";
import { installKeyboard } from "./routes/keyboard.ts";
import { createNavigation } from "./routes/navigation.ts";
import { exposeSwitchTimes } from "./routes/switchTimer.ts";
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

const appearance = (value: Parameters<typeof applyAppearance>[0]) => {
  applyAppearance(value);
  connection.setDensity(value.density);
};

appearance({ theme: "system", density: "calm" });

void window.polaris.request("settings.get", {}).then((result) => {
  if (result.ok) appearance(result.value);
});

window.polaris.onAppEvent((event) => {
  if (event.kind === "route") navigation.actions.setMode(event.route);
  else if (event.kind === "appearance") appearance(event.appearance);
  else {
    void startProofSession({ api: window.polaris, store: connection.store, hostKey: event.hostKey })
      .then((sessionId) => navigation.actions.selectSession({ hostKey: event.hostKey, sessionId }))
      .catch((cause: unknown) => console.error("polaris: proof session failed", cause));
  }
});

installKeyboard(navigation.actions);

exposeSwitchTimes();

const root = document.getElementById("root");

if (root !== null) createRoot(root).render(<App value={{ connection, navigation }} />);
