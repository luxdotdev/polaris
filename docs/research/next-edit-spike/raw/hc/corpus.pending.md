## hrn01 rename apps/site/scripts/smoke-feed.ts hash=5cce6fbc5f7b0260 cursorLine=41 card
### history
@L21
-      event: Schema.Literals(["update_check", "download"]),
+      request_id: Schema.String,
+      method: Schema.Literal("GET"),
@L24
-
+      service: Schema.Literal("polaris-site"),
+      commit: Schema.NullOr(Schema.String),
+      deployment_id: Schema.NullOr(Schema.String),
+      environment: Schema.NullOr(Schema.String),
+      region: Schema.NullOr(Schema.String),
+      event: Schema.Literals(["update_check", "download"]),
@L35
-      status: Schema.Number,
+      release_version: Schema.optional(Schema.NullOr(Schema.String)),
+      update: Schema.optional(Schema.Literals(["current", "available"])),
+      rejection: Schema.optional(Schema.Literal("invalid_version")),
+      failure: Schema.optional(Schema.String),
+      status_code: Schema.Number,
+      outcome: Schema.Literals(["success", "rejected", "error"]),
+      duration_ms: Schema.Number,
### shown
@@ -41,2 +41,9 @@
       duration_ms: Schema.Number,
+      service: Schema.Literal("polaris-site"),
+      commit: Schema.NullOr(Schema.String),
+      deployment_id: Schema.NullOr(Schema.String),
+      environment: Schema.NullOr(Schema.String),
+      region: Schema.NullOr(Schema.String),
+      event: Schema.Literals(["update_check", "download"]),
+      version: Schema.NullOr(Schema.String),
     })

### expected
@@ -172,3 +172,3 @@
       assert.deepEqual(
-        events.map((event) => event.status),
+        events.map((event) => event.status_code),
         statuses


## hrn10 rename apps/daemon/src/reviewer/index.ts hash=85d3793b74aefa23 cursorLine=244 card
### history
@L31
-import { reviewerDecision } from "./policy.ts";
+import { canRunChecks, reviewerDecision } from "./policy.ts";
@L47
-        Effect.sync(() => (sessions.has(request.sessionId) ? reviewerDecision(request) : null)),
+        Effect.sync(() =>
+          sessions.has(request.sessionId)
+            ? reviewerDecision(request, { runChecks: canRunChecks(request.harness) })
+            : null
+        ),
+      readOnly: (sessionId) => sessions.has(sessionId),
@L159
-        return resolveReviewer(yield* loadSettings(path), workspaceId, harnesses);
+        const settings = yield* loadSettings(path);
+
+        return { settings, resolved: resolveReviewer(settings, workspaceId, harnesses) };
@L175
-          const ok = yield* runLayers(summary, range, { resolved, context: request.context });
+          const ok = yield* runLayers(summary, range, { plan, context: request.context });
@L244
-          return { settings: yield* loadSettings(path), resolved: yield* resolve(workspaceId) };
+          return yield* resolve(workspaceId);
### shown
@@ -246,2 +246,3 @@
       setSettings: (settings) => saveSettings(path, settings),
+      canRunChecks: (harness) => canRunChecks(harness),
     });

### expected
@@ -170,4 +170,4 @@
 
-        if (started.resolved === null) return started.summary;
-        const { summary, range, resolved } = started;
+        if (started.plan === null) return started.summary;
+        const { summary, range, plan } = started;
 


## hdd03 dead-code apps/desktop/src/renderer/features/review/ui/SubjectHeader.tsx hash=da0d3b711e974608 cursorLine=119 card
### history
@L98
-          <span className="text-title text-text-subtle shrink-0">#{number}</span>
+          <span className="text-title text-text-subtle shrink-0 font-normal">#{number}</span>
@L112
-              <span>{detail.author?.login ?? "ghost"} wants to merge into</span>
+              <span>
+                {detail.author?.login ?? "ghost"} wants to merge {detail.commits}{" "}
+                {detail.commits === 1 ? "commit" : "commits"} into
+              </span>
@L119
-              <span className="text-text-subtle truncate">
-                · {detail.repo}
-                {fileCount === null ? "" : ` · ${fileCount} ${fileCount === 1 ? "file" : "files"}`}
-              </span>
+              <span className="text-text-subtle truncate">· {detail.repo}</span>
### shown
@@ -118,3 +118,6 @@
               <Chip>{detail.headRefName}</Chip>
-              <span className="text-text-subtle truncate">· {detail.repo}</span>
+              <span className="text-text-subtle truncate">
+                · {detail.repo}
+                {fileCount === null ? "" : ` · ${fileCount} ${fileCount === 1 ? "file" : "files"}`}
+              </span>
             </>

### expected
@@ -85,4 +85,2 @@
 export const PullHeader = ({ name, number, detail, actions }: PullHeaderProps) => {
-  const fileCount = detail === null ? null : detail.files.length;
-
   return (


## hdd05 dead-code apps/daemon/src/files/search/fallback.ts hash=73e10201da0f19dc cursorLine=310 card
### history
@L7
-import { existsSync, type FSWatcher, watch as fsWatch } from "node:fs";
+import { existsSync } from "node:fs";
@L13
-
+import { WALK_SKIP, watchRoot } from "./watch.ts";
@L296
-      const watcher: FSWatcher = fsWatch(root, { recursive: true }, (event, name) => {
-        if (name === null) return;
-        const rel = name.toString();
-
-        if (rel === ".git" || rel.startsWith(".git/") || rel.includes("/.git/")) return;
-        const path = join(root, rel);
+      const close = await watchRoot(root, (event, path) => {
@L308
-      // A Workspace at ~ holds sockets; Bun's watcher reports opening one (ENXIO) as an error event.
-      watcher.on("error", () => undefined);
-
+
@L310
-        watcher.close();
+        close();
### shown
@@ -309,3 +309,3 @@
         clearTimeout(timer);
-        close();
+        await close();
         watchers.delete(stop);

### expected
@@ -17,5 +17,2 @@
 
-/** Directories the walk skips outside git repositories (inside, .gitignore decides). */
-const WALK_SKIP = new Set([".git", "node_modules", ".hg", ".svn"]);
-
 /** How long a file list is reused before it is rebuilt. */


## him02 import apps/desktop/src/renderer/features/open-folder/rows.ts hash=8a9cd4e6c75aa62b cursorLine=89 card
### history
@L9
-/** What a row does: open a folder as a Workspace, step into one, or ask Finder (this Mac). */
+/** What a row does: open a folder as a Workspace, step into one, or ask the OS folder picker (the local Host). */
@L83
-    input.host.alias === null
+    input.host.kind === "local"
@L89
-              title: "Choose in Finder…",
+              title: clientCopy().chooseFolder,
### shown
@@ -88,3 +88,3 @@
               id: "finder",
-              title: clientCopy().chooseFolder,
+              title: input.host.status.host?.chooseFolder ?? "Choose in Finder…",
               target: { kind: "finder" },

### expected
@@ -3,2 +3,3 @@
 import type { HostView } from "../../../shared/api.ts";
+import { clientCopy } from "../../../shared/clientCopy.ts";
 import { useApp } from "../../shell/hooks.ts";


## him05 import apps/daemon/src/reviewer/prompt.ts hash=f66a03052604baca cursorLine=12 card
### history
@L12
-/** Marks a Reviewer prompt; the bench Harness answers it with schema output. */
-export const REVIEWER_MARKER = "<!-- polaris:reviewer -->";
+export { REVIEWER_MARKER } from "./markers.ts";
### shown
@@ -11,3 +11,3 @@
 
-export { REVIEWER_MARKER } from "./markers.ts";
+export const REVIEWER_MARKER = "<!-- polaris:reviewer -->";
 

### expected
@@ -9,2 +9,3 @@
 import { reviewerOutputJsonSchema } from "./output.ts";
+import { REVIEWER_MARKER } from "./markers.ts";
 import type { ReviewerShell } from "./policy.ts";


## him07 import apps/daemon/src/transport/serve.ts hash=f7c78ce61ee0b86f cursorLine=126 card
### history
@L101
-
+  PredictionServerLive,
@L126
-
+  "prediction.server",
### shown
@@ -115,3 +115,3 @@
   ReviewReadRpcsLive,
-  AcceptRpcsLive,
+  PredictionServerLive,
   ReviewerRpcsLive,
@@ -123,4 +123,2 @@
   "prediction.context",
-  "inline.propose",
-  "prediction.complete",
   "prediction.server",

### expected
@@ -1,2 +1,3 @@
 import { PredictionCapabilityLive } from "../prediction/capability.ts";
+import { PredictionServerLive } from "../prediction/server.ts";
 /**


## him10 import packages/client/src/transport.ts hash=13e00c1fc8bd7b87 cursorLine=179 card
### history
@L162
-/** Connects straight to a Daemon's Unix socket (the local Host). */
-export const socketTransport = (path: string): Connector =>
+/**
+ * Connects straight to a Daemon's Unix socket (the local Host). With
+ * `installedHome`, a refusal says whether a Daemon is installed there and what its log says.
+ */
+export const socketTransport = (path: string, installedHome?: string): Connector =>
@L179
-                ? new ConnectFailure({
-                    kind: "needs-attention",
-                    reason: "daemon-not-running",
-                    detail: `no Daemon is listening on ${path}`,
-                  })
+                ? localDaemonFailure(path, installedHome)
### shown
@@ -178,3 +178,7 @@
               error.code === "ENOENT" || error.code === "ECONNREFUSED"
-                ? localDaemonFailure(path, installedHome)
+                ? new ConnectFailure({
+                    kind: "needs-attention",
+                    reason: "daemon-not-running",
+                    detail: `no Daemon is listening on ${path}`,
+                  })
                 : new ConnectFailure({

### expected
@@ -12,2 +12,3 @@
 import { ConnectFailure, classifyExit, type NeedsAttentionReason } from "./failures.ts";
+import { localDaemonFailure } from "./localDaemon.ts";
 


## hin01 insertion apps/desktop/scripts/dmg.ts hash=1b99978a6c9481d0 cursorLine=15 card
### history
@L21
-    resolveSigning(signingCredentials(process.env))
+    signing === "unsigned" ? null : signing
@L15
-
+const signing = resolveSig
### shown
@@ -14,3 +14,4 @@
 
-const signing = resolveSig
+const signing = process.env.SIGNING === "unsigned" ? null : process.env.SIGNING;
+
 console.log(
@@ -21,3 +22,3 @@
     join(REPO_ROOT, "design/assets"),
-    signing === "unsigned" ? null : signing
+    signing
   )

### expected
@@ -14,3 +14,4 @@
 
-const signing = resolveSig
+const signing = resolveSigning(signingCredentials(process.env));
+
 console.log(


## hin06 insertion apps/desktop/src/renderer/features/session/ui/items.tsx hash=2fe565b5281359a9 cursorLine=72 card
### history
@L155
-
+/** A tool that names a text file: its menu opens or reveals that file. */
+const textFile = (item: ToolView) => (item.file === null || item.file.image ? null : item.file);
+
@L163
-
+    data-menu-path={textFile(item)?.path}
+    data-menu-line={textFile(item)?.line ?? undefined}
@L72
-
+        data-menu-path={change.kind
### shown
@@ -71,3 +71,4 @@
         className="group/file hover:bg-fill-hover h-row flex items-center pr-1"
-        data-menu-path={change.kind
+        data-menu-path={textFile(item)?.path}
+        data-menu-line={textFile(item)?.line ?? undefined}
       >

### expected
@@ -71,3 +71,4 @@
         className="group/file hover:bg-fill-hover h-row flex items-center pr-1"
-        data-menu-path={change.kind
+        data-menu-path={change.kind === "delete" ? undefined : change.path}
+        data-menu-diff=""
       >


## hin12 insertion apps/daemon/src/languages/composition/managedAvailability.ts hash=80b6fff3fa662e06 cursorLine=34 card
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
@@ -33,13 +33,7 @@
 ) => {
-  if (develope
-  if (
-    !managedProviders.has(toolId) ||
-    phase !== "feature" ||
-    managed === undefined ||
-    admission === undefined ||
-    settings === undefined
-  )
-    return installation.inspect(
-      toolId,
-      phase,
+  if (developerProviders.has(toolId) || managed === undefined || admission === undefined || settings === undefined) {
+    return installation.inspect(toolId, phase);
+  }
+  return Effect.succeed(LanguageAvailability.Available);
+};
       trusted || (managedProviders.has(toolId) && managed !== undefined),

### expected
@@ -33,3 +33,5 @@
 ) => {
-  if (develope
+  if (developerProvider(toolId))
+    return developerAvailability(installation, toolId, phase, trusted, admission);
+
   if (


## hin13 insertion apps/desktop/src/main/index.ts hash=091f2398fa60adcb cursorLine=328 card
### history
@L3
-
+import { createPredictionBridge } from "./prediction/bridge.ts";
@L338
-
+      predictionBridge,
@L328
-
+  const predictionBrid
### shown
@@ -325,5 +325,4 @@
 
-  const predictionPlacement = createMainPredictionPlacement(runtime, predictionSettings);
+  const predictionBridge = createPredictionBridge(runtime, predictionSettings);
 
-  const predictionBrid
   ipc = registerIpc({

### expected
@@ -327,3 +327,10 @@
 
-  const predictionBrid
+  const predictionBridge = createPredictionBridge({
+    runtime,
+    placement: predictionPlacement,
+    preferences: predictionSettings,
+    read: () => settings,
+    commit: (value) => updateSettings(() => value),
+  });
+
   ipc = registerIpc({


## hrf04 refactor apps/daemon/src/inline/live.ts hash=579c41229eb3b2a2 cursorLine=22 card
### history
@L8
-
+/** `POLARIS_CLAUDE` / `POLARIS_CODEX` override the PATH lookup; null when neither finds it. */
+export const harnessBinary = (harness: "claude" | "codex"): string | null =>
+  process.env[harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(harness) || null;
+
@L22
-        message: `${name} was not found on PATH`,
+        message: `${request.harness} was not found on PATH`,
### shown
@@ -15,4 +15,3 @@
 
-    const binary =
-      process.env[request.harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(name);
+    const binary = harnessBinary(request.harness);
 
@@ -21,3 +20,3 @@
         reason: "harness-failed",
-        message: `${request.harness} was not found on PATH`,
+        message: `${name} was not found on PATH`,
       });

### expected
@@ -13,7 +13,4 @@
   function* (request, cwd, progress) {
-    const name = request.harness === "claude" ? "claude" : "codex";
+    const binary = harnessBinary(request.harness);
 
-    const binary =
-      process.env[request.harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(name);
-
     if (!binary)


## hrf10 refactor apps/desktop/src/main/machines/index.ts hash=59c496d473141a78 cursorLine=79 card
### history
@L13
-import type { LocalDaemon } from "../localDaemon.ts";
+import type { LocalHost } from "../local/index.ts";
@L64
-    localDaemon: input.localDaemon,
-    localHome: input.localHome,
-    localListening: input.localListening,
+
@L72
-      HostAccess.layer({
-        platform: input.platform ?? process.platform,
-        ssh: { sshBinary: input.settings.get().sshBinary },
-        wsl: { env: input.env },
-      })
+      Layer.mergeAll(
+        HostAccess.layer({
+          platform: input.platform ?? process.platform,
+          ssh: { sshBinary: input.settings.get().sshBinary },
+          wsl: { env: input.env },
+        }),
+        input.localHost
+      )
### shown
@@ -77,3 +77,3 @@
         }),
-        input.localHost
+        input.localHome
       )

### expected
@@ -40,5 +40,4 @@
   readonly dev: boolean;
-  readonly localDaemon: () => Promise<LocalDaemon>;
-  readonly localHome: () => string | null;
-  readonly localListening: (home: string) => Promise<void>;
+  /** This Client's local Host, if it can have one (`LocalHost.forPlatform`). */
+  readonly localHost: Layer.Layer<LocalHost>;
 }


## hrf11 refactor apps/desktop/src/main/prediction/bridge.ts hash=a1e266a21536de08 cursorLine=62 card
### history
@L6
-import { HostDirectory, type ClientRuntime } from "../hosts.ts";
+import { HostDirectory, LOCAL_HOST_KEY, type ClientRuntime } from "../hosts.ts";
@L56
-
+        // The local Host's own name ("This Mac"), never the network hostname.
+        const clientLabel = directory.entry(LOCAL_HOST_KEY)?.label ?? hostname();
@L62
-            hostKey === "local" ? hostname() : (directory.entry(hostKey)?.label ?? hostKey),
+            directory.entry(hostKey)?.label ?? (hostKey === LOCAL_HOST_KEY ? clientLabel : hostKey),
### shown
@@ -59,5 +59,5 @@
         return {
-          clientLabel: hostname(),
+          clientLabel,
           hostLabel:
-            directory.entry(hostKey)?.label ?? (hostKey === LOCAL_HOST_KEY ? clientLabel : hostKey),
+            hostKey === LOCAL_HOST_KEY ? clientLabel : directory.entry(hostKey)?.label ?? hostKey,
         };

### expected
@@ -59,3 +59,3 @@
         return {
-          clientLabel: hostname(),
+          clientLabel,
           hostLabel:


## hrf12 refactor packages/ui/gallery/sections/floating.tsx hash=8073fddfeab7d883 cursorLine=146 card
### history
@L130
-              { kind: "item", label: "Rename", shortcut: "F2", onSelect: noop },
+              { kind: "item", label: "Rename…", needsInput: true, shortcut: "F2", onSelect: noop },
@L146
-                label: "Delete…",
-                needsInput: true,
+                label: "Delete",
### shown
@@ -145,3 +145,4 @@
                 kind: "item",
-                label: "Delete",
+                label: "Delete…",
+                needsInput: true,
                 destructive: true,

### expected
@@ -126,4 +126,4 @@
             entries={[
-              { kind: "item", label: "New file", onSelect: noop },
-              { kind: "item", label: "New folder", onSelect: noop },
+              { kind: "item", label: "New file…", needsInput: true, onSelect: noop },
+              { kind: "item", label: "New folder…", needsInput: true, onSelect: noop },
               MENU_SEPARATOR_ENTRY,


## rf01 refactor apps/desktop/src/main/machines/views.ts hash=8a52a9690cf0ff50 cursorLine=162 ctx1
### history
@L6
-import { type DaemonReport, upgradeDue } from "@polaris/client/install";
+import { type DaemonReport, backgroundUpgradeDue } from "@polaris/client/install";
@L136
- * new connection to a Daemon the bundled build should replace (`upgradeDue`). Null otherwise.
+ * new connection to a Daemon the bundled build should replace (`backgroundUpgradeDue`). Null otherwise.
@L153
-    return upgradeDue(status.host.daemonVersion, bundledVersion) ? `upgrade:${status.epoch}` : null;
+    return backgroundUpgradeDue(status.host.daemonVersion, bundledVersion)
+      ? `upgrade:${status.epoch}`
+      : null;
@L162
- * The local Host's background check: only an upgrade (`upgradeDue`) of the
+ * The local Host's background check: only an upgrade (`backgroundUpgradeDue`) of the
### shown
@@ -153,3 +153,3 @@
     return backgroundUpgradeDue(status.host.daemonVersion, bundledVersion)
-      ? `upgrade:${status.epoch}`
+      ? `background-upgrade:${status.epoch}`
       : null;

### expected
@@ -175,3 +175,5 @@
 
-  return upgradeDue(status.host.daemonVersion, bundledVersion) ? `upgrade:${status.epoch}` : null;
+  return backgroundUpgradeDue(status.host.daemonVersion, bundledVersion)
+    ? `upgrade:${status.epoch}`
+    : null;
 };


## im03 import apps/daemon/src/files/trash.ts hash=d7de8da1c75da5d3 cursorLine=20 ctx1
### history
@L20
-
+    env: childEnv(),
### shown
@@ -15,4 +15,9 @@
   }
-}`;
+};
 
+const childEnv = () => ({
+  NSUserDomainMask: 1,
+  NSAppleScriptEnabled: 1,
+});
+
 const macTrash = async (path: string): Promise<void> => {

### expected
@@ -1 +1,2 @@
+import { childEnv } from "../service/childEnv.ts";
 import { randomUUID } from "node:crypto";


## im04 import apps/daemon/src/harness/registry.ts hash=01058f50ba94042a cursorLine=27 ctx1
### history
@L27
-  process.env[env] || Bun.which(name) || null;
+  process.env[env] || which(name) || null;
### shown
@@ -25,4 +25,6 @@
 
-const binary = (env: string, name: string): string | null =>
-  process.env[env] || which(name) || null;
+const which = (name: string): string | null => {
+  const path = process.env.PATH?.split(":") ?? [];
+  return path.find((p) => Bun.which(`${p}/${name}`));
+};
 

### expected
@@ -24,2 +24,3 @@
 import { PlanLimitReporter } from "./limits/PlanLimitReporter.ts";
+import { which } from "../service/userPath.ts";
 


## hrn10 rename apps/daemon/src/reviewer/index.ts hash=d3870f5a9314f04c cursorLine=244 ctx1
### history
@L31
-import { reviewerDecision } from "./policy.ts";
+import { canRunChecks, reviewerDecision } from "./policy.ts";
@L47
-        Effect.sync(() => (sessions.has(request.sessionId) ? reviewerDecision(request) : null)),
+        Effect.sync(() =>
+          sessions.has(request.sessionId)
+            ? reviewerDecision(request, { runChecks: canRunChecks(request.harness) })
+            : null
+        ),
+      readOnly: (sessionId) => sessions.has(sessionId),
@L159
-        return resolveReviewer(yield* loadSettings(path), workspaceId, harnesses);
+        const settings = yield* loadSettings(path);
+
+        return { settings, resolved: resolveReviewer(settings, workspaceId, harnesses) };
@L175
-          const ok = yield* runLayers(summary, range, { resolved, context: request.context });
+          const ok = yield* runLayers(summary, range, { plan, context: request.context });
@L244
-          return { settings: yield* loadSettings(path), resolved: yield* resolve(workspaceId) };
+          return yield* resolve(workspaceId);
### shown
@@ -246,2 +246,3 @@
       setSettings: (settings) => saveSettings(path, settings),
+      readOnly: (sessionId) => sessions.has(sessionId),
     });

### expected
@@ -170,4 +170,4 @@
 
-        if (started.resolved === null) return started.summary;
-        const { summary, range, resolved } = started;
+        if (started.plan === null) return started.summary;
+        const { summary, range, plan } = started;
 


## hdd04 dead-code apps/daemon/src/languages/media/native.ts hash=0757fda8640a2884 cursorLine=25 ctx1
### history
@L2
-import { closeSync, constants, fstatSync, openSync, readdirSync } from "node:fs";
+import { closeSync, constants, fstatSync, openSync } from "node:fs";
@L5
-
+import { hostPlatform, libcPath } from "../../platform/index.ts";
@L15
-  if (process.platform === "darwin") return "/usr/lib/libSystem.B.dylib";
+  const { os } = hostPlatform();
@L17
-  if (process.platform !== "linux")
+  if (os !== "darwin" && os !== "linux")
@L25
-  return loader === undefined ? "libc.so.6" : `/lib/${loader}`;
+  return libcPath();
### shown
@@ -24,3 +24,3 @@
 
-  return libcPath();
+  return libcPath(os);
 }

### expected
@@ -22,3 +22,2 @@
     });
-  const loader = readdirSync("/lib").find((name) => /^ld-musl-.+\.so\.1$/.test(name));
 


## hin12 insertion apps/daemon/src/languages/composition/managedAvailability.ts hash=984382bc633d2df1 cursorLine=34 ctx1
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
@@ -33,10 +33,3 @@
 ) => {
-  if (develope
-  if (
-    !managedProviders.has(toolId) ||
-    phase !== "feature" ||
-    managed === undefined ||
-    admission === undefined ||
-    settings === undefined
-  )
+  if (developerProviders.has(toolId) || !managedProviders.has(toolId)) {
     return installation.inspect(

### expected
@@ -33,3 +33,5 @@
 ) => {
-  if (develope
+  if (developerProvider(toolId))
+    return developerAvailability(installation, toolId, phase, trusted, admission);
+
   if (


## hin13 insertion apps/desktop/src/main/index.ts hash=e464428acc89a38b cursorLine=328 ctx1
### history
@L3
-
+import { createPredictionBridge } from "./prediction/bridge.ts";
@L338
-
+      predictionBridge,
@L328
-
+  const predictionBrid
### shown
@@ -327,3 +327,4 @@
 
-  const predictionBrid
+  const predictionBridge = createPredictionBridge(runtime, predictionSettings);
+
   ipc = registerIpc({

### expected
@@ -327,3 +327,10 @@
 
-  const predictionBrid
+  const predictionBridge = createPredictionBridge({
+    runtime,
+    placement: predictionPlacement,
+    preferences: predictionSettings,
+    read: () => settings,
+    commit: (value) => updateSettings(() => value),
+  });
+
   ipc = registerIpc({


## rn02 rename apps/site/app/api/update/_lib/windows.ts hash=f38b8ff7200184e9 cursorLine=122 nolast
### history
@L5
-
+  releasesPage,
@L122
-        if (!release) return unavailable();
+        if (!release) return releasesPage();
### shown
@@ -121,3 +121,3 @@
 
-        if (!release) return releasesPage();
+        if (!release) return Response.json({ error: "No release found." }, { status: 404, headers });
 

### expected
@@ -133,3 +133,3 @@
 
-        return unavailable();
+        return releasesPage();
       }


## rf01 refactor apps/desktop/src/main/machines/views.ts hash=a25766d01580d261 cursorLine=162 nolast
### history
@L6
-import { type DaemonReport, upgradeDue } from "@polaris/client/install";
+import { type DaemonReport, backgroundUpgradeDue } from "@polaris/client/install";
@L136
- * new connection to a Daemon the bundled build should replace (`upgradeDue`). Null otherwise.
+ * new connection to a Daemon the bundled build should replace (`backgroundUpgradeDue`). Null otherwise.
@L153
-    return upgradeDue(status.host.daemonVersion, bundledVersion) ? `upgrade:${status.epoch}` : null;
+    return backgroundUpgradeDue(status.host.daemonVersion, bundledVersion)
+      ? `upgrade:${status.epoch}`
+      : null;
@L162
- * The local Host's background check: only an upgrade (`upgradeDue`) of the
+ * The local Host's background check: only an upgrade (`backgroundUpgradeDue`) of the
### shown
@@ -164,3 +164,3 @@
  */
-export const localUpgradeKey = (
+export const localBackgroundUpgradeKey = (
   view: HostView,

### expected
@@ -175,3 +175,5 @@
 
-  return upgradeDue(status.host.daemonVersion, bundledVersion) ? `upgrade:${status.epoch}` : null;
+  return backgroundUpgradeDue(status.host.daemonVersion, bundledVersion)
+    ? `upgrade:${status.epoch}`
+    : null;
 };


## dd06 dead-code apps/desktop/src/renderer/features/review/ui/Queue.tsx hash=d5a183c386fd5cef cursorLine=55 nolast
### history
@L42
-/** Whether the digit modifier is held (Control; Alt on Windows): the first nine rows show their chord. */
+/** Whether Control is held: the first nine rows show their ⌃N (Ctrl+N off macOS). */
@L51
-      if (event.key !== key) return;
-      setHeld(!event.metaKey && !event.shiftKey && (alt ? !event.ctrlKey : !event.altKey));
+      if (event.key === "Control") setHeld(!event.metaKey && !event.altKey && !event.shiftKey);
@L55
-      if (event.key === key || !(alt ? event.altKey : event.ctrlKey)) setHeld(false);
+      if (event.key === "Control" || !event.ctrlKey) setHeld(false);
### shown
@@ -50,3 +50,3 @@
     const down = (event: KeyboardEvent) => {
-      if (event.key === "Control") setHeld(!event.metaKey && !event.altKey && !event.shiftKey);
+      if (event.key === key) setHeld(!event.metaKey && !event.altKey && !event.shiftKey);
     };
@@ -54,3 +54,3 @@
     const up = (event: KeyboardEvent) => {
-      if (event.key === "Control" || !event.ctrlKey) setHeld(false);
+      if (event.key === key || !(alt ? event.altKey : event.ctrlKey)) setHeld(false);
     };

### expected
@@ -46,5 +46,2 @@
   useEffect(() => {
-    const alt = digitModifiersFor(currentKeyPlatform())[0] === "Alt";
-    const key = alt ? "Alt" : "Control";
-
     const down = (event: KeyboardEvent) => {


## hrn01 rename apps/site/scripts/smoke-feed.ts hash=51afc4f888e33e7e cursorLine=41 nolast
### history
@L21
-      event: Schema.Literals(["update_check", "download"]),
+      request_id: Schema.String,
+      method: Schema.Literal("GET"),
@L24
-
+      service: Schema.Literal("polaris-site"),
+      commit: Schema.NullOr(Schema.String),
+      deployment_id: Schema.NullOr(Schema.String),
+      environment: Schema.NullOr(Schema.String),
+      region: Schema.NullOr(Schema.String),
+      event: Schema.Literals(["update_check", "download"]),
@L35
-      status: Schema.Number,
+      release_version: Schema.optional(Schema.NullOr(Schema.String)),
+      update: Schema.optional(Schema.Literals(["current", "available"])),
+      rejection: Schema.optional(Schema.Literal("invalid_version")),
+      failure: Schema.optional(Schema.String),
+      status_code: Schema.Number,
+      outcome: Schema.Literals(["success", "rejected", "error"]),
+      duration_ms: Schema.Number,
### shown
@@ -41,2 +41,8 @@
       duration_ms: Schema.Number,
+      service: Schema.Literal("polaris-site"),
+      commit: Schema.NullOr(Schema.String),
+      deployment_id: Schema.NullOr(Schema.String),
+      environment: Schema.NullOr(Schema.String),
+      region: Schema.NullOr(Schema.String),
+      event: Schema.Literals(["update_check", "download"]),
     })

### expected
@@ -172,3 +172,3 @@
       assert.deepEqual(
-        events.map((event) => event.status),
+        events.map((event) => event.status_code),
         statuses


## hrn10 rename apps/daemon/src/reviewer/index.ts hash=30bf549bb0da1406 cursorLine=244 nolast
### history
@L31
-import { reviewerDecision } from "./policy.ts";
+import { canRunChecks, reviewerDecision } from "./policy.ts";
@L47
-        Effect.sync(() => (sessions.has(request.sessionId) ? reviewerDecision(request) : null)),
+        Effect.sync(() =>
+          sessions.has(request.sessionId)
+            ? reviewerDecision(request, { runChecks: canRunChecks(request.harness) })
+            : null
+        ),
+      readOnly: (sessionId) => sessions.has(sessionId),
@L159
-        return resolveReviewer(yield* loadSettings(path), workspaceId, harnesses);
+        const settings = yield* loadSettings(path);
+
+        return { settings, resolved: resolveReviewer(settings, workspaceId, harnesses) };
@L175
-          const ok = yield* runLayers(summary, range, { resolved, context: request.context });
+          const ok = yield* runLayers(summary, range, { plan, context: request.context });
@L244
-          return { settings: yield* loadSettings(path), resolved: yield* resolve(workspaceId) };
+          return yield* resolve(workspaceId);
### shown
@@ -243,3 +243,4 @@
         Effect.gen(function* () {
-          return yield* resolve(workspaceId);
+          const plan = yield* store.plan(workspaceId);
+          return { plan, resolved: yield* resolve(workspaceId) };
         }),

### expected
@@ -170,4 +170,4 @@
 
-        if (started.resolved === null) return started.summary;
-        const { summary, range, resolved } = started;
+        if (started.plan === null) return started.summary;
+        const { summary, range, plan } = started;
 


## hrn13 rename apps/desktop/src/renderer/features/constellation/preview/Preview.tsx hash=569cc94cdb6334c1 cursorLine=147 nolast
### history
@L28
-
+  slugRecord,
@L94
-
+  "slugs",
@L114
-  return c1Record(scene === "paused" ? { state: "paused" } : {});
+  return slugRecord(scene === "paused" ? { state: "paused" } : {});
@L120
-
+/** A and B folded, so the slug ids in "daemon" and "desktop" are in view. */
+const SLUG_FOLDS = new Map([
+  ["A · Events and decider", false],
+  ["B · Spec and tools", false],
+]);
+
@L147
-
+  slugs: { selected: "task:email-validator", folds: SLUG_FOLDS },
### shown
@@ -147,2 +147,3 @@
   slugs: { selected: "task:email-validator", folds: SLUG_FOLDS },
+  slugs: { selected: "task:email-validator", folds: SLUG_FOLDS },
 };

### expected
@@ -107,3 +107,3 @@
 
-  if (scene === "handed") return c1Record({ attempts: handedUpAttempts() });
+  if (scene === "handed") return slugRecord({ attempts: handedUpAttempts() });
 


## hdd07 dead-code apps/daemon/src/harness/claude/ClaudeDriver.ts hash=cb1740c1e4e76704 cursorLine=557 nolast
### history
@L478
-    turn: ActiveTurn | null = null
+    turn: ActiveTurn | null = null,
+    uuid: NonNullable<SDKUserMessage["uuid"]> = crypto.randomUUID()
@L541
-    yield* switchTo(input.model, input.effort);
-    const { uuid, message } = yield* send(input.prompt, input);
+
+    if (input.effort !== null && !isEffortLevel(input.effort))
+      return yield* unknownEffort(input.effort);
+    const uuid = crypto.randomUUID();
+
@L555
-
+    // Reserve the user's Turn before controls or attachment reads can yield to a native run.
+    yield* switchTo(input.model, input.effort);
+    const { message } = yield* send(input.prompt, input, active, uuid);
### shown
@@ -555,3 +555,4 @@
     // Reserve the user's Turn before controls or attachment reads can yield to a native run.
-    yield* switchTo(input.model, input.effort);
+    if (input.effort !== null && !isEffortLevel(input.effort))
+      return yield* unknownEffort(input.effort);
     const { message } = yield* send(input.prompt, input, active, uuid);

### expected
@@ -480,3 +480,2 @@
   ) {
-    const uuid = crypto.randomUUID();
     turn?.pending.add(uuid);


## hdd12 dead-code apps/desktop/src/main/machines/service.ts hash=f61fef45bf39154e cursorLine=551 nolast
### history
@L155
-
+  const copy = clientCopy(input.platform);
@L209
-        probing: PROBING_LOCAL,
+        probing: `Checking the daemon installed on ${copy.machine}.`,
@L234
-          ? fail("this Mac's daemon is the app's own, not one Polaris installed")
+          ? fail(`${copy.machine}'s daemon is the app's own, not one Polaris installed`)
@L405
-          ? "This Mac has no daemon Polaris installed yet. Use Install first."
+          ? `${copy.localHost} has no daemon Polaris installed yet. Use Install first.`
@L551
-        return yield* fail(
-          `Polaris names ${clientCopy(input.platform).machine} "local"; rename the alias to add it`
-        );
+        return yield* fail(`Polaris names ${copy.machine} "local"; rename the alias to add it`);
### shown
@@ -550,3 +550,3 @@
       if (machine.alias === LOCAL_HOST_KEY) {
-        return yield* fail(`Polaris names ${copy.machine} "local"; rename the alias to add it`);
+        return yield* fail(`Polaris names ${copy.localHost} "local"; rename the alias to add it`);
       }

### expected
@@ -95,4 +95,2 @@
 const PROBING = "Asking over SSH for the platform and any installed daemon.";
-
-const PROBING_LOCAL = "Checking the daemon installed on this Mac.";
 


## hin01 insertion apps/desktop/scripts/dmg.ts hash=cb89d634c2e619a0 cursorLine=15 nolast
### history
@L21
-    resolveSigning(signingCredentials(process.env))
+    signing === "unsigned" ? null : signing
@L15
-
+const signing = resolveSig
### shown
@@ -14,3 +14,4 @@
 
-const signing = resolveSig
+const signing = process.env.SIGNING === "unsigned" ? null : signingCredentials(process.env);
+
 console.log(
@@ -21,3 +22,3 @@
     join(REPO_ROOT, "design/assets"),
-    signing === "unsigned" ? null : signing
+    signing
   )

### expected
@@ -14,3 +14,4 @@
 
-const signing = resolveSig
+const signing = resolveSigning(signingCredentials(process.env));
+
 console.log(


## hin06 insertion apps/desktop/src/renderer/features/session/ui/items.tsx hash=97f082ed195b7aa0 cursorLine=72 nolast
### history
@L155
-
+/** A tool that names a text file: its menu opens or reveals that file. */
+const textFile = (item: ToolView) => (item.file === null || item.file.image ? null : item.file);
+
@L163
-
+    data-menu-path={textFile(item)?.path}
+    data-menu-line={textFile(item)?.line ?? undefined}
@L72
-
+        data-menu-path={change.kind
### shown
@@ -71,3 +71,4 @@
         className="group/file hover:bg-fill-hover h-row flex items-center pr-1"
-        data-menu-path={change.kind
+        data-menu-path={change.path}
+        data-menu-line={change.line ?? undefined}
       >

### expected
@@ -71,3 +71,4 @@
         className="group/file hover:bg-fill-hover h-row flex items-center pr-1"
-        data-menu-path={change.kind
+        data-menu-path={change.kind === "delete" ? undefined : change.path}
+        data-menu-diff=""
       >


## hin13 insertion apps/desktop/src/main/index.ts hash=6fbf6e9938d2e6bb cursorLine=328 nolast
### history
@L3
-
+import { createPredictionBridge } from "./prediction/bridge.ts";
@L338
-
+      predictionBridge,
@L328
-
+  const predictionBrid
### shown
@@ -327,3 +327,8 @@
 
-  const predictionBrid
+  const predictionBridge = createPredictionBridge({
+    runtime,
+    predictionSettings,
+    predictionPlacement,
+  });
+
   ipc = registerIpc({

### expected
@@ -327,3 +327,10 @@
 
-  const predictionBrid
+  const predictionBridge = createPredictionBridge({
+    runtime,
+    placement: predictionPlacement,
+    preferences: predictionSettings,
+    read: () => settings,
+    commit: (value) => updateSettings(() => value),
+  });
+
   ipc = registerIpc({


## hrf11 refactor apps/desktop/src/main/prediction/bridge.ts hash=0e830f654e1ffa53 cursorLine=62 nolast
### history
@L6
-import { HostDirectory, type ClientRuntime } from "../hosts.ts";
+import { HostDirectory, LOCAL_HOST_KEY, type ClientRuntime } from "../hosts.ts";
@L56
-
+        // The local Host's own name ("This Mac"), never the network hostname.
+        const clientLabel = directory.entry(LOCAL_HOST_KEY)?.label ?? hostname();
@L62
-            hostKey === "local" ? hostname() : (directory.entry(hostKey)?.label ?? hostKey),
+            directory.entry(hostKey)?.label ?? (hostKey === LOCAL_HOST_KEY ? clientLabel : hostKey),
### shown
@@ -59,5 +59,5 @@
         return {
-          clientLabel: hostname(),
+          clientLabel,
           hostLabel:
-            directory.entry(hostKey)?.label ?? (hostKey === LOCAL_HOST_KEY ? clientLabel : hostKey),
+            hostKey === LOCAL_HOST_KEY ? clientLabel : (directory.entry(hostKey)?.label ?? hostKey),
         };

### expected
@@ -59,3 +59,3 @@
         return {
-          clientLabel: hostname(),
+          clientLabel,
           hostLabel:


## rn04 rename apps/desktop/src/renderer/features/machines/updates/Controls.tsx hash=ff268ebab65d247b cursorLine=40 w15
### history
@L40
-    <DropdownMenuLabel>Daemon updates</DropdownMenuLabel>
+    <DropdownMenuLabel>Daemon upgrades</DropdownMenuLabel>
### shown
@@ -36,3 +36,3 @@
 /** The row menu's section: a radio group under its label. */
-export const OverrideMenuItems = ({ daemon, onChange }: OverrideProps) => (
+export const UpgradeMenuItems = ({ daemon, onChange }: OverrideProps) => (
   <>

### expected
@@ -63,3 +63,3 @@
   >
-    <SelectTrigger aria-label="Daemon updates" className="text-label h-7 w-[260px]">
+    <SelectTrigger aria-label="Daemon upgrades" className="text-label h-7 w-[260px]">
       <SelectValue />


## dd04 dead-code apps/desktop/src/renderer/features/settings/editor/Advanced.tsx hash=96ce52a05b23e292 cursorLine=106 w15
### history
@L3
-import { ChevronDownIcon, ChevronRightIcon } from "@polaris/ui";
+import { DisclosureChevron } from "@polaris/ui";
@L106
-        <Chevron size={12} className="text-text-subtle shrink-0" />
+        <DisclosureChevron open={open} size={12} className="text-text-subtle" />
### shown
@@ -99,16 +99,10 @@
     <section aria-label="Advanced" className="flex flex-col gap-4">
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
+      <DisclosureChevron open={open} size={12} className="text-text-subtle" />
+      <span className="text-body text-text-default font-medium">Advanced</span>
+      <span className="text-caption text-text-faint">
+        Custom language servers and executable overrides, per host
+      </span>
+      <div className="flex flex-col gap-4">
+        {open &&
+          (api && host ? (
           <Sections {...props} api={api} host={host} />

### expected
@@ -94,3 +94,2 @@
   const [open, setOpen] = useState(false);
-  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
   const { api, host } = props;


## dd06 dead-code apps/desktop/src/renderer/features/review/ui/Queue.tsx hash=05da96c95263e948 cursorLine=55 w15
### history
@L42
-/** Whether the digit modifier is held (Control; Alt on Windows): the first nine rows show their chord. */
+/** Whether Control is held: the first nine rows show their ⌃N (Ctrl+N off macOS). */
@L51
-      if (event.key !== key) return;
-      setHeld(!event.metaKey && !event.shiftKey && (alt ? !event.ctrlKey : !event.altKey));
+      if (event.key === "Control") setHeld(!event.metaKey && !event.altKey && !event.shiftKey);
@L55
-      if (event.key === key || !(alt ? event.altKey : event.ctrlKey)) setHeld(false);
+      if (event.key === "Control" || !event.ctrlKey) setHeld(false);
### shown
@@ -47,4 +47,2 @@
     const alt = digitModifiersFor(currentKeyPlatform())[0] === "Alt";
-    const key = alt ? "Alt" : "Control";
-
     const down = (event: KeyboardEvent) => {

### expected
@@ -46,5 +46,2 @@
   useEffect(() => {
-    const alt = digitModifiersFor(currentKeyPlatform())[0] === "Alt";
-    const key = alt ? "Alt" : "Control";
-
     const down = (event: KeyboardEvent) => {


## im04 import apps/daemon/src/harness/registry.ts hash=17247b0a42636df1 cursorLine=27 w15
### history
@L27
-  process.env[env] || Bun.which(name) || null;
+  process.env[env] || which(name) || null;
### shown
@@ -25,4 +25,12 @@
 
-const binary = (env: string, name: string): string | null =>
-  process.env[env] || which(name) || null;
+const which = (name: string): string | null => {
+  if (process.env.PATH) {
+    const paths = process.env.PATH.split(":");
+    for (const path of paths) {
+      const bin = `${path}/${name}`;
+      if (Bun.which(bin)) return bin;
+    }
+  }
+  return null;
+};
 

### expected
@@ -24,2 +24,3 @@
 import { PlanLimitReporter } from "./limits/PlanLimitReporter.ts";
+import { which } from "../service/userPath.ts";
 


## hdd03 dead-code apps/desktop/src/renderer/features/review/ui/SubjectHeader.tsx hash=4b10074a2e99f81f cursorLine=119 w15
### history
@L98
-          <span className="text-title text-text-subtle shrink-0">#{number}</span>
+          <span className="text-title text-text-subtle shrink-0 font-normal">#{number}</span>
@L112
-              <span>{detail.author?.login ?? "ghost"} wants to merge into</span>
+              <span>
+                {detail.author?.login ?? "ghost"} wants to merge {detail.commits}{" "}
+                {detail.commits === 1 ? "commit" : "commits"} into
+              </span>
@L119
-              <span className="text-text-subtle truncate">
-                · {detail.repo}
-                {fileCount === null ? "" : ` · ${fileCount} ${fileCount === 1 ? "file" : "files"}`}
-              </span>
+              <span className="text-text-subtle truncate">· {detail.repo}</span>
### shown
@@ -119,2 +119,3 @@
               <span className="text-text-subtle truncate">· {detail.repo}</span>
+              <span className="text-text-subtle truncate">· {fileCount ?? 0} files</span>
             </>

### expected
@@ -85,4 +85,2 @@
 export const PullHeader = ({ name, number, detail, actions }: PullHeaderProps) => {
-  const fileCount = detail === null ? null : detail.files.length;
-
   return (


## hdd04 dead-code apps/daemon/src/languages/media/native.ts hash=fdbcabbe631abd3f cursorLine=25 w15
### history
@L2
-import { closeSync, constants, fstatSync, openSync, readdirSync } from "node:fs";
+import { closeSync, constants, fstatSync, openSync } from "node:fs";
@L5
-
+import { hostPlatform, libcPath } from "../../platform/index.ts";
@L15
-  if (process.platform === "darwin") return "/usr/lib/libSystem.B.dylib";
+  const { os } = hostPlatform();
@L17
-  if (process.platform !== "linux")
+  if (os !== "darwin" && os !== "linux")
@L25
-  return loader === undefined ? "libc.so.6" : `/lib/${loader}`;
+  return libcPath();
### shown
@@ -29,3 +29,3 @@
 const load = () =>
-  dlopen(libraryPath(), {
+  dlopen(libcPath(), {
     openat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },

### expected
@@ -22,3 +22,2 @@
     });
-  const loader = readdirSync("/lib").find((name) => /^ld-musl-.+\.so\.1$/.test(name));
 


## hdd05 dead-code apps/daemon/src/files/search/fallback.ts hash=3bdad05dcb4d7596 cursorLine=310 w15
### history
@L7
-import { existsSync, type FSWatcher, watch as fsWatch } from "node:fs";
+import { existsSync } from "node:fs";
@L13
-
+import { WALK_SKIP, watchRoot } from "./watch.ts";
@L296
-      const watcher: FSWatcher = fsWatch(root, { recursive: true }, (event, name) => {
-        if (name === null) return;
-        const rel = name.toString();
-
-        if (rel === ".git" || rel.startsWith(".git/") || rel.includes("/.git/")) return;
-        const path = join(root, rel);
+      const close = await watchRoot(root, (event, path) => {
@L308
-      // A Workspace at ~ holds sockets; Bun's watcher reports opening one (ENXIO) as an error event.
-      watcher.on("error", () => undefined);
-
+
@L310
-        watcher.close();
+        close();
### shown
@@ -307,6 +307,6 @@
 
-      const stop = () => {
+      const stop = async () => {
         clearTimeout(timer);
-        close();
-        watchers.delete(stop);
+        await Promise.all([...watchers].map((stop) => stop()));
+        watchers.clear();
       };

### expected
@@ -17,5 +17,2 @@
 
-/** Directories the walk skips outside git repositories (inside, .gitignore decides). */
-const WALK_SKIP = new Set([".git", "node_modules", ".hg", ".svn"]);
-
 /** How long a file list is reused before it is rebuilt. */


## him03 import apps/desktop/src/renderer/features/editor/explorer/ui/Explorer.tsx hash=7c6bd8774358a6f4 cursorLine=242 w15
### history
@L168
-
+  const openChanges = useChangeOpener(place, data.state.git, open);
+  const shownDiff = useShownDiff(host.key, workspace.id);
+
@L231
-
+            onOpenChanges={openChanges}
+            shownDiff={shownDiff}
@L237
-            active={tabs.active}
+            active={selectedPath("head", shownDiff, tabs.active)}
@L240
-
+            onOpenChanges={
+              openChanges === null ? null : (path, pin) => openChanges("head", path, pin)
+            }
### shown
@@ -242,2 +242,3 @@
             }
+            shownDiff={shownDiff}
           />

### expected
@@ -27,2 +27,3 @@
 import { openFile, setAgentEdits, setAgentFiles, useEditorTabs } from "../../index.ts";
+import { selectedPath, useChangeOpener, useShownDiff } from "../../diff/index.ts";
 import { basename } from "../model/paths.ts";


## hin02 insertion apps/desktop/src/renderer/features/risk/ui/VerdictPopover.tsx hash=85b3ca8cc9dd26ec cursorLine=135 w15
### history
@L138
-
+  /** Held by the caller when the form opens from elsewhere too (the finding's menu). */
+  readonly open?: boolean;
+  readonly onOpenChange?: (open: boolean) => void;
@L142
-  const [open, setOpen] = useState(false);
+  const [own, setOwn] = useState(false);
+  const open = shown ?? own;
+  const setOpen = onOpenChange ?? setOwn;
@L135
-
+  open:
### shown
@@ -134,3 +134,4 @@
   onSave,
-  open:
+  open,
+  onOpenChange,
 }: {

### expected
@@ -134,3 +134,4 @@
   onSave,
-  open:
+  open: shown,
+  onOpenChange,
 }: {


## hin12 insertion apps/daemon/src/languages/composition/managedAvailability.ts hash=3c7645e93f61ba4f cursorLine=34 w15
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
@@ -33,3 +33,5 @@
 ) => {
-  if (develope
+  if (developerProviders.has(toolId) || managedProviders.has(toolId)) {
+    return LanguageAvailability.Available;
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


## hin13 insertion apps/desktop/src/main/index.ts hash=99aa900bb2eb232c cursorLine=328 w15
### history
@L3
-
+import { createPredictionBridge } from "./prediction/bridge.ts";
@L338
-
+      predictionBridge,
@L328
-
+  const predictionBrid
### shown
@@ -327,3 +327,8 @@
 
-  const predictionBrid
+  const predictionBridge = createPredictionBridge({
+    runtime,
+    settings: predictionSettings,
+    placement: predictionPlacement,
+    trusted,
+  });
   ipc = registerIpc({

### expected
@@ -327,3 +327,10 @@
 
-  const predictionBrid
+  const predictionBridge = createPredictionBridge({
+    runtime,
+    placement: predictionPlacement,
+    preferences: predictionSettings,
+    read: () => settings,
+    commit: (value) => updateSettings(() => value),
+  });
+
   ipc = registerIpc({


## hin14 insertion apps/desktop/src/main/index.ts hash=cc201ef75de473d1 cursorLine=320 w15
### history
@L1
-
+import { createMainPredictionPlacement } from "./prediction/placement.ts";
+import { PredictionSettings } from "./prediction/preferences.ts";
@L328
-
+      predictionSettings,
+      predictionPlacement,
@L320
-
+  const predictionSett
### shown
@@ -319,3 +319,10 @@
 
-  const predictionSett
+  const predictionSettings = new PredictionSettings(
+    () => settings,
+    (value) => updateSettings(() => value)
+  );
+  const predictionPlacement = createMainPredictionPlacement(
+    predictionSettings,
+    runtime
+  );
   ipc = registerIpc({

### expected
@@ -319,3 +319,9 @@
 
-  const predictionSett
+  const predictionSettings = new PredictionSettings(
+    () => settings,
+    (value) => updateSettings(() => value)
+  );
+
+  const predictionPlacement = createMainPredictionPlacement(runtime, predictionSettings);
+
   ipc = registerIpc({


## hrf04 refactor apps/daemon/src/inline/live.ts hash=fc4a0518ddb3e325 cursorLine=22 w15
### history
@L8
-
+/** `POLARIS_CLAUDE` / `POLARIS_CODEX` override the PATH lookup; null when neither finds it. */
+export const harnessBinary = (harness: "claude" | "codex"): string | null =>
+  process.env[harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(harness) || null;
+
@L22
-        message: `${name} was not found on PATH`,
+        message: `${request.harness} was not found on PATH`,
### shown
@@ -16,3 +16,3 @@
     const binary =
-      process.env[request.harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(name);
+      process.env[request.harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(request.harness);
 

### expected
@@ -13,7 +13,4 @@
   function* (request, cwd, progress) {
-    const name = request.harness === "claude" ? "claude" : "codex";
+    const binary = harnessBinary(request.harness);
 
-    const binary =
-      process.env[request.harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(name);
-
     if (!binary)

