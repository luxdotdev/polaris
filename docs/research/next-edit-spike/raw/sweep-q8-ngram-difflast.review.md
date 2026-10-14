# sweep-q8-ngram-difflast (sweep-difflast) — non-exact outputs at the scored step

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
@@ line 26
-        enabled: available,
+        enabled: acceptable,
```

## dd03 dead-code in-window 
expected:
```diff
@@ line 48
-const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
-
```
predicted:
```diff
@@ line 48
-const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
+const currentKeyPlatform = () => {
+  if (typeof navigator !== "undefined") {
+    return /Mac/.test(navigator.userAgent) ? "mac" : "win";
+  }
+  return "win";
+};
```

## dd04 dead-code OUT-of-window deletes-healthy noise-out-of-window
expected:
```diff
@@ line 95
-  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
```
predicted:
```diff
@@ line 96
-  const { api, host } = props;
-
-  return (
-    <section aria-label="Advanced" className="flex flex-col gap-4">
-      <button
-        type="button"
-        aria-expanded={open}
-        onClick={() => setOpen(!open)}
-        className="flex cursor-default items-center gap-2 self-start px-0.5 py-1 text-left"
-      >
-        <DisclosureChevron open={open} size={12} className="text-text-subtle" />
-        <span className="text-body text-text-default font-medium">Advanced</span>
-        <span className="text-caption text-text-faint">
-          Custom language servers and executable overrides, per host
-        </span>
-      </button>
-      {open &&
-        (api && host ? (
-          <Sections {...props} api={api} host={host} />
+  const { api, host, providers } = props;
+
+  return (
+    <section aria-label="Advanced" className="flex flex-col gap-4">
+      <button
+        type="button"
+        aria-expanded={open}
+        onClick={() => setOpen(!open)}
+        className="flex cursor-default items-center gap-2 self-start px-0.5 py-1 text-left"
+      >
+        <DisclosureChevron open={open} size={12} className="text-text-subtle" />
+        <span className="text-body text-text-default font-medium">Advanced</span>
+        <span className="text-caption text-text-faint">
+          Custom language servers and executable overrides, per host
+        </span>
+      </button>
+      {open &&
+        (api && host ? (
+          <Sections {...props} api={api} host={host} providers={providers} />
```

## im02 import in-window deletes-healthy
expected:
```diff
@@ line 8
+import { VERSION } from "../service/platform.ts";
```
predicted:
```diff
@@ line 10
-export const DAEMON_VERSION = VERSION;
+export const DAEMON_VERSION = process.env.VERSION || "0.0.0";
```

## im03 import OUT-of-window deletes-healthy noise-out-of-window
expected:
```diff
@@ line 1
+import { childEnv } from "../service/childEnv.ts";
```
predicted:
```diff
@@ line 16
-}`;
+};
+
+const childEnv = () => ({
+  NSUserDomainMask: 1,
+  NSAppleScriptEnabled: 1,
+});
```

## im04 import in-window deletes-healthy
expected:
```diff
@@ line 25
+import { which } from "../service/userPath.ts";
```
predicted:
```diff
@@ line 26
-const binary = (env: string, name: string): string | null =>
-  process.env[env] || which(name) || null;
+const which = (name: string): string | null => {
+  const path = process.env.PATH?.split(":") ?? [];
+  return path.find((p) => Bun.which(`${p}/${name}`));
+};
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
+        return { taskId: id, text: `${id} has an outcome`, rank: 5 };
```
