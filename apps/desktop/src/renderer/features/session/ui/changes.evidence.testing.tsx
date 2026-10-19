/**
 * Evidence for Output's Changes tab (ENG-379): a Turn's diff with a TypeScript, a CSS and a
 * Python file through the real rows and worker pool. `?theme=light` and `?cvd` switch the look.
 */
import "../../../styles.css";
// The app's slots first, as main.tsx loads them: Output reaches them through a cycle.
import "../../../app/slots.tsx";
import { TooltipProvider } from "@polaris/ui";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { parseUnifiedDiff } from "../model/diff.ts";
import { TurnChanges } from "./SessionOutput.tsx";

const PATCH = `diff --git a/src/connect.ts b/src/connect.ts
--- a/src/connect.ts
+++ b/src/connect.ts
@@ -12,9 +12,11 @@ import { Effect } from "effect";
 /** Opens the Host's socket, retrying once. */
 export const connect = (host: Host, port = 22) =>
   Effect.gen(function* () {
-    const socket = yield* dial(host.address, port);
+    const socket = yield* dial(host.address, port, { timeout: "4 seconds" });
+    // A slow Host gets one more try before the Connection State says Offline.
+    yield* Effect.retry(socket.ready, { times: 1 });
     return new Session({ socket, name: \`\${host.name}:\${port}\` });
   });

 export type Dialer = typeof connect;
@@ -40,4 +42,4 @@ export class Session {
   readonly name: string;
-  close(): void {}
+  close(): Promise<void> { return this.socket.end(); }
 }
diff --git a/styles/card.css b/styles/card.css
--- a/styles/card.css
+++ b/styles/card.css
@@ -1,6 +1,7 @@
 .card {
-  border: 1px solid #333;
+  border: 1px solid var(--color-hairline);
+  border-radius: 10px;
   padding: 12px 16px;
   /* the sunken well */
   background: var(--color-surface-sunken);
 }
diff --git a/tools/sync.py b/tools/sync.py
new file mode 100644
--- /dev/null
+++ b/tools/sync.py
@@ -0,0 +1,8 @@
+import subprocess
+
+
+def sync(remote: str = "origin") -> int:
+    """Fetch and fast-forward the current branch."""
+    result = subprocess.run(["git", "pull", "--ff-only", remote], check=False)
+    return result.returncode  # 0 when it moved
+
`;

const params = new URLSearchParams(location.search);

document.documentElement.dataset.theme = params.get("theme") === "light" ? "light" : "dark";

if (params.has("cvd")) document.documentElement.dataset.diffPalette = "cvd";

const store = createStore<AppState>(() => initialState);

const connection: Connection = {
  store,
  openSession: () => () => {},
  setDensity: (density) => store.setState({ density }),
  setAppearance: (patch) => store.setState(patch),
};

const root = document.getElementById("root");

if (root === null) throw new Error("no root");

createRoot(root).render(
  <AppProvider
    value={{
      connection,
      navigation: createNavigation({ app: store, storage: null }),
      commands: createCommandRegistry({ platform: "mac" }),
    }}
  >
    <TooltipProvider>
      <div className="bg-bg text-text-default flex h-screen w-[560px] flex-col">
        <TurnChanges files={parseUnifiedDiff(PATCH)} folded={new Set()} onFold={() => {}} />
      </div>
    </TooltipProvider>
  </AppProvider>
);
