import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { connect } from "./store/store.ts";
import { App } from "./views/App.tsx";
import { ConnectionProvider } from "./views/hooks.ts";

const connection = connect(window.polaris);

window.polaris.onMenu((command) => connection.setRoute(command.route));

const root = document.getElementById("root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <ConnectionProvider value={connection}>
        <App />
      </ConnectionProvider>
    </StrictMode>
  );
}
