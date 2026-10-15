## hin07 insertion apps/desktop/src/renderer/features/machines/HostsSettingsPage.tsx hash=b643e59cc921c7f4 cursorLine=118
### history
@L12
-import { call, useMachines, useNow } from "./hooks.tsx";
+import { call, useMachines, useNow, useWslDistros } from "./hooks.tsx";
@L24
-
+import { addHint, hostsIntro } from "./wsl.ts";
@L159
-        <p className="text-body text-text-subtle">
-          Machines Polaris reaches over SSH, using your ~/.ssh/config. Each runs its own daemon;
-          this Mac installs and upgrades them.
-        </p>
+        <p className="text-body text-text-subtle">{hostsIntro(onWindows)}</p>
@L180
-
+          wsl={wsl}
+          onLookAgain={again}
@L194
-          <span className="text-caption text-text-subtle">
-            Pick an alias from ~/.ssh/config; the first install asks for your approval.
-          </span>
+          <span className="text-caption text-text-subtle">{addHint(onWindows)}</span>
@L118
-
+  const { wsl, aga
### shown
@@ -117,3 +117,3 @@
   const machines = useMachines();
-  const { wsl, aga
+  const { wsl, aga } = useWslDistros();
   const [adder, setAdder] = useState(adding);

### expected
@@ -117,3 +117,5 @@
   const machines = useMachines();
-  const { wsl, aga
+  const { wsl, again } = useWslDistros();
+  // Off Windows the answer is `unsupported` and the page reads as it always has.
+  const onWindows = wsl !== null && wsl.status !== "unsupported";
   const [adder, setAdder] = useState(adding);


## hin12 insertion apps/daemon/src/languages/composition/managedAvailability.ts hash=8d549c5e17ee0643 cursorLine=34
### history
@L8
-
+import { developerAvailability } from "../go/availability.ts";
+import { developerProvider } from "../go/launch.ts";
@L19
-
+  "phpactor",
@L34
-
+  if (develope
### shown
@@ -33,3 +33,10 @@
 ) => {
-  if (develope
+  if (developerProviders.has(toolId) || developerProvider.has(toolId)) {
+    return Effect.succeed(
+      LanguageAvailability.Success({
+        trusted,
+        available: true,
+      })
+    );
+  }
   if (

### expected
@@ -33,3 +33,5 @@
 ) => {
-  if (develope
+  if (developerProvider(toolId))
+    return developerAvailability(installation, toolId, phase, trusted, admission);
+
   if (

