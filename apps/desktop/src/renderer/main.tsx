import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { onNeedsYouEvent } from "./features/needs-you/index.ts";
import { applyAppearance } from "./appearance.ts";
import { createOnboarding } from "./features/onboarding/index.ts";
import { startProofSession } from "./proof.ts";
import { createCommandRegistry } from "./routes/commands.ts";
import { installKeyboard } from "./routes/keyboard.ts";
import { createNavigation } from "./routes/navigation.ts";
import { exposeSwitchTimes } from "./routes/switchTimer.ts";
import type { Density } from "../shared/api.ts";
import { shellCommands } from "./shell/commands.ts";
import { connect } from "./store/store.ts";

const connection = connect(window.polaris);

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

const onboarding = createOnboarding({ api: window.polaris, store: connection.store });

const navigation = createNavigation({
  app: connection.store,
  storage,
  ensureWorkspace: onboarding.workspaceFor,
});

const commands = createCommandRegistry({ mac: /Mac/.test(navigator.userAgent) });

commands.register(
  shellCommands({
    connection,
    navigation,
    dark: () => {
      const { theme } = connection.store.getState();

      return theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
        : theme === "dark";
    },
  })
);

// `#preview/<scene>`: the shell on fixtures, for screenshots (features/session/preview).
const preview = location.hash.startsWith("#preview/");

// `#needs-you/<scene>`: the inbox and hover card on fixtures (features/needs-you/preview).
const needsYouPreview = location.hash.startsWith("#needs-you/");

let setPreviewDensity: ((density: Density) => void) | null = null;

const appearance = (value: Parameters<typeof applyAppearance>[0]) => {
  applyAppearance(value);
  connection.setAppearance(value);
  setPreviewDensity?.(value.density);
};

appearance({ theme: "system", density: "calm" });

void window.polaris.request("settings.get", {}).then((result) => {
  if (result.ok) appearance(result.value);
});

window.polaris.onAppEvent((event) => {
  if (event.kind === "command") commands.run(event.id);
  else if (event.kind === "appearance") appearance(event.appearance);
  else if (event.kind === "needs-you") onNeedsYouEvent(event, navigation.actions);
  else {
    void startProofSession({ api: window.polaris, store: connection.store, hostKey: event.hostKey })
      .then((sessionId) => navigation.actions.selectSession({ hostKey: event.hostKey, sessionId }))
      .catch((cause: unknown) => console.error("polaris: proof session failed", cause));
  }
});

installKeyboard({ actions: navigation.actions, registry: commands });

exposeSwitchTimes();

const root = document.getElementById("root");

if (root !== null && preview) {
  void import("./features/session/preview/Preview.tsx").then((m) => {
    setPreviewDensity = m.mountPreview(root, location.hash);
  });
} else if (root !== null && needsYouPreview) {
  void import("./features/needs-you/preview/Preview.tsx").then((m) => {
    setPreviewDensity = m.mountNeedsYouPreview(root, location.hash);
  });
} else if (root !== null) {
  createRoot(root).render(
    <App value={{ connection, navigation, commands }} onboarding={onboarding} />
  );
}
