import "./styles.css";
import { Toaster, TooltipProvider } from "@polaris/ui";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { applyAppearance } from "./appearance.ts";
import { connect } from "./store/store.ts";
import { App } from "./views/App.tsx";
import { ConnectionProvider } from "./views/hooks.ts";

const connection = connect(window.polaris);

applyAppearance({ theme: "system", density: "calm" });

void window.polaris.request("settings.get", {}).then((result) => {
  if (result.ok) applyAppearance(result.value);
});

window.polaris.onAppEvent((event) => {
  if (event.kind === "route") connection.setRoute(event.route);
  else applyAppearance(event.appearance);
});

const root = document.getElementById("root");

// `#preview/<scene>`: the session view on fixtures, for screenshots (its own chunk).
const Preview = lazy(() =>
  import("./features/session/preview/Preview.tsx").then((m) => ({ default: m.Preview }))
);

const preview = location.hash.startsWith("#preview/");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <ConnectionProvider value={connection}>
        <TooltipProvider>
          {preview ? (
            <Suspense>
              <Preview hash={location.hash} />
            </Suspense>
          ) : (
            <App />
          )}
          <Toaster />
        </TooltipProvider>
      </ConnectionProvider>
    </StrictMode>
  );
}
