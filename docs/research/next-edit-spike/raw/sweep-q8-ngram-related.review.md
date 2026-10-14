# sweep-q8-ngram-related (sweep-related) — non-exact outputs at the scored step

## rn01 rename OUT-of-window deletes-healthy noise-out-of-window
expected:
```diff
@@ line 109
-        ? { "X-Polaris-Windows-Version": view.macOSVersion }
-        : { "X-Polaris-macOS-Version": view.macOSVersion };
+        ? { "X-Polaris-Windows-Version": view.osVersion }
+        : { "X-Polaris-macOS-Version": view.osVersion };
```
predicted:
```diff
@@ line 91
-    platform,
+    platform: input.platform,
```

## rn04 rename OUT-of-window deletes-healthy reverts-user-edit noise-out-of-window
expected:
```diff
@@ line 64
-    <SelectTrigger aria-label="Daemon updates" className="text-label h-7 w-[260px]">
+    <SelectTrigger aria-label="Daemon upgrades" className="text-label h-7 w-[260px]">
```
predicted:
```diff
@@ line 40
-    <DropdownMenuLabel>Daemon upgrades</DropdownMenuLabel>
+    <DropdownMenuLabel>Daemon updates</DropdownMenuLabel>
```

## rf01 refactor OUT-of-window deletes-healthy noise-out-of-window
expected:
```diff
@@ line 176
-  return upgradeDue(status.host.daemonVersion, bundledVersion) ? `upgrade:${status.epoch}` : null;
+  return backgroundUpgradeDue(status.host.daemonVersion, bundledVersion)
+    ? `upgrade:${status.epoch}`
+    : null;
```
predicted:
```diff
@@ line 154
-      ? `upgrade:${status.epoch}`
+      ? `background-upgrade:${status.epoch}`
```

## rf06 refactor in-window deletes-healthy
expected:
```diff
@@ line 16
+    const acceptable = () => {
+      const view = getActiveEditor()?.view;
+
+      return available() && view !== undefined && !visibleGhost(view.state)?.provisional;
+    };
+
```
predicted:
```diff
@@ line 23
-      "editor.prediction.accept": { enabled: acceptable, run: () => accept(false) },
-      "editor.prediction.acceptWord": { enabled: acceptable, run: () => accept(true) },
-      "editor.prediction.dismiss": {
-        enabled: available,
+      "editor.prediction.accept": { enabled: visibleGhost, run: () => accept(false) },
+      "editor.prediction.acceptWord": { enabled: visibleGhost, run: () => accept(true) },
+      "editor.prediction.dismiss": {
+        enabled: visibleGhost,
```

## dd02 dead-code OUT-of-window deletes-healthy reverts-user-edit noise-out-of-window
expected:
```diff
@@ line 10
-const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
-
```
predicted:
```diff
@@ line 27
-    return parent === null ? undefined : forwardShellChords(parent);
+    return parent === null ? undefined : forwardShellChords(parent, mac);
```

## dd06 dead-code in-window deletes-healthy reverts-user-edit
expected:
```diff
@@ line 47
-    const alt = digitModifiersFor(currentKeyPlatform())[0] === "Alt";
-    const key = alt ? "Alt" : "Control";
-
```
predicted:
```diff
@@ line 55
-      if (event.key === "Control" || !event.ctrlKey) setHeld(false);
+      if (event.key === key || !(alt ? event.altKey : event.ctrlKey)) setHeld(false);
```

## im02 import in-window deletes-healthy reverts-user-edit
expected:
```diff
@@ line 8
+import { VERSION } from "../service/platform.ts";
```
predicted:
```diff
@@ line 10
-export const DAEMON_VERSION = VERSION;
+export const DAEMON_VERSION = "0.0.0";
```

## im04 import in-window deletes-healthy reverts-user-edit
expected:
```diff
@@ line 25
+import { which } from "../service/userPath.ts";
```
predicted:
```diff
@@ line 27
-  process.env[env] || which(name) || null;
+  process.env[env] || Bun.which(name) || null;
```

## im05 import in-window deletes-healthy reverts-user-edit
expected:
```diff
@@ line 11
+import { polaris } from "./bridge.ts";
```
predicted:
```diff
@@ line 15
-  const result = await polaris().request("dispatch", {
+  const result = await window.polaris.request("dispatch", {
```

## im06 import OUT-of-window deletes-healthy reverts-user-edit noise-out-of-window
expected:
```diff
@@ line 13
+import { Predicate } from "effect";
```
predicted:
```diff
@@ line 39
-    if (Predicate.isTagged(item, "AssistantMessage") && item.text.trim() !== "") return item.text;
+    if (item._tag === "AssistantMessage" && item.text.trim() !== "") return item.text;
```

## in01 insertion in-window 
expected:
```diff
@@ line 29
-          env: c
+          env: childEnv(),
```
predicted:
```diff
@@ line 29
-          env: c
+          env: childEnv(run.cwd),
```

## in04 insertion in-window 
expected:
```diff
@@ line 30
-      case 
+      case "setup":
+        return { taskId: id, text: `${id} setup failed · ${setupOutcome(attention.run)}`, rank: 4 };
```
predicted:
```diff
@@ line 30
-      case 
+      case "outcome":
+        return { taskId: id, text: setupOutcome(row.attempt), rank: 5 };
```
