# sweep-q8-none (sweep) — non-exact outputs at the scored step

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

## rf06 refactor in-window deletes-healthy reverts-user-edit
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
+      "editor.prediction.accept": { enabled: available, run: () => accept(false) },
+      "editor.prediction.acceptWord": { enabled: available, run: () => accept(true) },
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
+          env: childEnv,
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
+        return {
+          taskId: id,
+          text: setupOutcome(facts, id),
+          rank: 5,
+        };
```
