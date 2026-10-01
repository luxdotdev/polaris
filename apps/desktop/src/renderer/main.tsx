import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { onNeedsYouEvent } from "./features/needs-you/index.ts";
import { applyAppearance } from "./appearance.ts";
import { connectSettings, settingsCommands, settingsStore } from "./features/settings/index.ts";
import { createOnboarding } from "./features/onboarding/index.ts";
import { startProofSession } from "./proof.ts";
import { createCommandRegistry } from "./routes/commands.ts";
import { installKeyboard } from "./routes/keyboard.ts";
import { onOpenPullEvent } from "./routes/review.ts";
import { createNavigation } from "./routes/navigation.ts";
import { exposeSwitchTimes } from "./routes/switchTimer.ts";
import type { Appearance, Density } from "../shared/api.ts";
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

commands.register(settingsCommands(navigation.actions));

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

// `#pulls/<scene>`: the pull request list on fixtures (features/pulls/preview).
const pullsPreview = location.hash.startsWith("#pulls/");

// `#review/<scene>`: Review on fixtures (features/review/preview).
const reviewPreview = location.hash.startsWith("#review/");

// `#checkout/<scene>`: the Review Checkout chip and menu on fixtures (features/review/checkout/preview).
const checkoutPreview = location.hash.startsWith("#checkout/");

// `#hosts/<scene>`: Settings → Hosts on fixtures, every daemon update state (features/machines/preview).
const hostsPreview = location.hash.startsWith("#hosts/");

// `#constellations/<scene>`: the sidebar, Needs you, Review, Settings and Usage parts of Constellations (features/sessions/preview).
const constellationsPreview = location.hash.startsWith("#constellations/");

let setPreviewDensity: ((density: Density) => void) | null = null;

const appearance = (value: Appearance) => {
  applyAppearance(value);
  connection.setAppearance(value);
  setPreviewDensity?.(value.density);
};

appearance(settingsStore.getState().appearance);

settingsStore.subscribe((state, prev) => {
  if (state.appearance !== prev.appearance) appearance(state.appearance);
});

connectSettings(window.polaris);

window.polaris.onAppEvent((event) => {
  if (event.kind === "command") commands.run(event.id);
  else if (event.kind === "needs-you") onNeedsYouEvent(event, navigation.actions);
  else if (event.kind === "open-pull") onOpenPullEvent(event.pull, navigation.actions);
  else if (event.kind === "proof") {
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
} else if (root !== null && constellationsPreview) {
  void import("./features/sessions/preview/Preview.tsx").then((m) => {
    setPreviewDensity = m.mountConstellationsPreview(root, location.hash);
  });
} else if (root !== null && pullsPreview) {
  void import("./features/pulls/preview/Preview.tsx").then((m) => {
    setPreviewDensity = m.mountPullsPreview(root, location.hash);
  });
} else if (root !== null && reviewPreview) {
  void import("./features/review/preview/Preview.tsx").then((m) => {
    setPreviewDensity = m.mountReviewPreview(root, location.hash);
  });
} else if (root !== null && checkoutPreview) {
  void import("./features/review/checkout/preview/Preview.tsx").then((m) => {
    setPreviewDensity = m.mountCheckoutPreview(root, location.hash);
  });
} else if (root !== null && hostsPreview) {
  void import("./features/machines/preview/Preview.tsx").then((m) => {
    setPreviewDensity = m.mountHostsPreview(root, location.hash);
  });
} else if (root !== null) {
  createRoot(root).render(
    <App value={{ connection, navigation, commands }} onboarding={onboarding} />
  );
}
