## fin01 insertion apps/desktop/src/renderer/features/harness/ui/HarnessCards.tsx hash=05fb9090112c6b87 cursorLine=114 
### history
@L109
-  const caption =
+  const status =
@L114
-
+  // The Model comes firs
### shown
@@ -120,3 +120,3 @@
       title={option.name}
-      caption={caption}
+      caption={status}
       onSelect={onSelect}

### expected
@@ -113,3 +113,5 @@
 
-  // The Model comes firs
+  // The Model comes first, so a truncated caption keeps it.
+  const caption = option.note === null ? status : `${status} · ${option.note}`;
+
   return (


## fin02 insertion apps/desktop/src/renderer/features/palette/store.ts hash=82228e532eac1ce7 cursorLine=29 
### history
@L43
-
+    void loadFollowUp(followUp);
@L29
-
+/** Swaps in a loading follow-up's
### shown
@@ -29,2 +29,4 @@
 /** Swaps in a loading follow-up's
+export const setFollowUp = (followUp: FollowUp) => paletteStore.setState({ followUp });
+
 export interface InstallInput {

### expected
@@ -28,3 +28,10 @@
 
-/** Swaps in a loading follow-up's
+/** Swaps in a loading follow-up's answer, unless the palette moved on meanwhile. */
+export const loadFollowUp = async (followUp: FollowUp) => {
+  if (followUp.load === undefined) return;
+  const next = await followUp.load();
+
+  if (paletteStore.getState().followUp === followUp) paletteStore.setState({ followUp: next });
+};
+
 export interface InstallInput {


## fin06 insertion apps/desktop/scripts/lib/githubFake/world.ts hash=5582069dbd79189a cursorLine=131 
### history
@L140
-
+  /** Pull request id → its commits, oldest first; the last is `headRefOid`. */
+  readonly commits: Map<string, Array<FakeCommit>>;
@L161
-
+  commits: new Map(
+    fixture.pulls.map((p) => [p.id, [{ oid: p.headRefOid, message: p.title, date: p.updatedAt }]])
+  ),
@L131
-
+/** A commit on a pull request
### shown
@@ -131,2 +131,8 @@
 /** A commit on a pull request
+export interface FakeCommit {
+  readonly oid: string;
+  readonly message: string;
+  readonly date: string;
+}
+
 export interface World {

### expected
@@ -130,3 +130,9 @@
 
-/** A commit on a pull request
+/** A commit on a pull request's branch, oldest first in `World.commits`. */
+export interface FakeCommit {
+  readonly oid: string;
+  readonly message: string;
+  readonly date: string;
+}
+
 export interface World {


## fin07 insertion apps/daemon/src/main.ts hash=651480b7f8cc75f0 cursorLine=21 
### history
@L11
-
+ *   polaris selftest               check this build's native libraries work here (exit 1 if not)
@L25
-    console.error(`usage: polaris <serve|bridge|install|uninstall|upgrade|version>`)
+    console.error(`usage: polaris <serve|bridge|install|uninstall|upgrade|version|selftest>`)
@L21
-
+  case "s
### shown
@@ -20,3 +20,5 @@
     break
-  case "s
+  case "selftest":
+    console.log("selftest: ok")
+    break
   default:

### expected
@@ -20,3 +20,9 @@
     break
-  case "s
+  case "selftest": {
+    const { selfTest } = await import("./service/selftest.ts")
+    const result = await selfTest()
+    console.log(result.lines.join("\n"))
+    process.exitCode = result.ok ? 0 : 1
+    break
+  }
   default:


## fin08 insertion apps/daemon/src/git/git.ts hash=f744dbcea2fa107e cursorLine=22 
### history
@L41
-  const proc = Bun.spawn(["git", ...args], {
+  const spawnOptions: Bun.SpawnOptions.OptionsObject<"ignore" | Blob, "pipe", "pipe"> = {
@L47
-  });
+  };
+
+  if (options.timeoutMs !== undefined) {
+    spawnOptions.timeout = options.timeoutMs;
+    spawnOptions.killSignal = "SIGKILL";
+  }
+
+  const proc = Bun.spawn(["git", ...args], spawnOptions);
@L22
-
+  /** Kill git (SIGKILL) after this l
### shown
@@ -21,3 +21,4 @@
   readonly okCodes?: ReadonlyArray<number>;
-  /** Kill git (SIGKILL) after this l
+  /** Kill git (SIGKILL) after this limit (in ms). */
+  readonly timeoutMs?: number;
 }

### expected
@@ -21,3 +21,4 @@
   readonly okCodes?: ReadonlyArray<number>;
-  /** Kill git (SIGKILL) after this l
+  /** Kill git (SIGKILL) after this long; it then fails with exit code 137 or similar. */
+  readonly timeoutMs?: number;
 }


## fin09 insertion apps/desktop/src/renderer/features/session/chrome.ts hash=5cc8344e869b664c cursorLine=16 
### history
@L21
-
+  /** A Polaris-authored steer's card (a steered digest) in place of the steer bubble; null keeps it. */
+  readonly steerCard?: (args: SteerCardArgs) => ReactNode | null;
@L16
-
+export interf
### shown
@@ -15,3 +15,11 @@
 
-export interf
+export interface SteerCardArgs {
+  readonly steerId: string;
+  /** The steer is folded to its one-line summary; a folded steer shows the agent's reply itself. */
+  readonly folded: boolean;
+  /** The user can fold this steer. Every steer folds now, the latest included (C2). */
+  readonly canFold: boolean;
+  readonly onToggle: () => void;
+}
+
 export interface SessionChrome {

### expected
@@ -15,3 +15,10 @@
 
-export interf
+export interface SteerCardArgs {
+  /** The Turn the steer landed in. */
+  readonly turnId: string;
+  /** The landed steer's item (`steer:…`). */
+  readonly itemId: string;
+  readonly text: string;
+}
+
 export interface SessionChrome {


## fin10 insertion apps/daemon/src/engine/testing.ts hash=9db0ae5f38388871 cursorLine=299 
### history
@L313
-
+    Layer.provide(options.checkpoints ?? Layer.empty),
@L299
-
+  /** Default: the fake, which writes no
### shown
@@ -299,2 +299,4 @@
   /** Default: the fake, which writes no
+   * commits, branches, or worktrees. */
+  readonly worktreeTracker?: Layer.Layer<WorktreeTracker>;
 }) => {

### expected
@@ -298,3 +298,4 @@
   readonly reviewCheckoutGit?: Layer.Layer<ReviewCheckoutGit>;
-  /** Default: the fake, which writes no
+  /** Default: the fake, which writes no refs; `CheckpointsLive` snapshots real repositories. */
+  readonly checkpoints?: Layer.Layer<Checkpoints>;
 }) => {


## fin11 insertion apps/desktop/src/renderer/features/constellation/model/facts.ts hash=7a9eaa12f682e2d2 cursorLine=32 
### history
@L56
-
+  quietSince: null,
@L32
-
+  /** When the worker last pro
### shown
@@ -31,3 +31,4 @@
   readonly queued: number;
-  /** When the worker last pro
+  /** When the worker last processed a command. */
+  readonly quietSince: string | null;
   /** Since when an approval has waited on the user, if one does. */

### expected
@@ -31,3 +31,4 @@
   readonly queued: number;
-  /** When the worker last pro
+  /** When the worker last produced output, shown while nothing runs. */
+  readonly quietSince: string | null;
   /** Since when an approval has waited on the user, if one does. */


## fin12 insertion packages/protocol/src/constellation/domain.ts hash=80d804933a1c27de cursorLine=213 
### history
@L244
-
+    resetsAt: optionalNullable(Timestamp),
@L213
-
+  /** A capacity failure's Plan Limit re
### shown
@@ -212,3 +212,4 @@
   failureKind: optionalNullable(FailureKind),
-  /** A capacity failure's Plan Limit re
+  /** A capacity failure's Plan Limit reset time. */
+  resetAt: optionalNullable(Timestamp),
   blockedOn: optionalArray(TaskId),

### expected
@@ -212,3 +212,4 @@
   failureKind: optionalNullable(FailureKind),
-  /** A capacity failure's Plan Limit re
+  /** A capacity failure's Plan Limit reset, when the Harness reported one; null when unknown. */
+  resetsAt: optionalNullable(Timestamp),
   blockedOn: optionalArray(TaskId),


## frf01 refactor apps/desktop/src/renderer/features/session/ui/whereMenus.tsx hash=2e82102770103ba6 cursorLine=93 
### history
@L93
-              <span className="flex flex-col">
+              <span className="flex flex-col py-1">
### shown
@@ -93,3 +93,3 @@
               <span className="flex flex-col py-1">
-                <span>{host.label}</span>
+                <span className="font-semibold">{host.label}</span>
                 <span className="text-caption text-text-subtle">

### expected
@@ -131,3 +131,3 @@
             <DropdownMenuRadioItem key={workspace.id} value={workspace.id}>
-              <span className="flex flex-col">
+              <span className="flex flex-col py-1">
                 <span>{workspace.name}</span>


## frf02 refactor packages/ui/src/components/polaris/approval-card.tsx hash=d54672e18529e9cf cursorLine=62 
### history
@L62
-        <Button variant="secondary" onClick={onAlwaysAllow}>
+        <Button variant="secondary" className="px-2.5" onClick={onAlwaysAllow}>
### shown
@@ -57,3 +57,3 @@
       <div className="border-hairline flex items-center gap-1.5 border-t px-3.5 py-2.5">
-        <Button variant="primary" onClick={onApprove}>
+        <Button variant="primary" className="px-2.5" onClick={onApprove}>
           Approve
@@ -65,3 +65,3 @@
         <span className="flex-1" />
-        <Button variant="ghost" onClick={onDeny}>
+        <Button variant="ghost" className="px-2.5" onClick={onDeny}>
           Deny

### expected
@@ -65,3 +65,3 @@
         <span className="flex-1" />
-        <Button variant="ghost" onClick={onDeny}>
+        <Button variant="ghost" className="px-2.5" onClick={onDeny}>
           Deny


## frf09 refactor apps/desktop/src/renderer/features/session/preview/Preview.tsx hash=2a3f2e298069d167 cursorLine=109 
### history
@L44
-
+  order,
@L109
-
+  "order",
### shown
@@ -114,2 +114,3 @@
   "usage-3",
+  "order",
 ] as const;

### expected
@@ -94,2 +94,3 @@
   background,
+  order,
 } as const;


## fim08 import apps/desktop/src/renderer/app/App.tsx hash=dcf266ed1a309972 cursorLine=12 
### history
@L12
-
+        <NeedsYouPublisher />
### shown
@@ -5,2 +5,3 @@
 import { Shell } from "./Shell.tsx";
+import { NeedsYouPublisher } from "./NeedsYouPublisher.tsx";
 

### expected
@@ -4,2 +4,3 @@
 import { type AppContextValue, AppProvider } from "../shell/hooks.ts";
+import { NeedsYouPublisher } from "../features/needs-you/index.ts";
 import { Shell } from "./Shell.tsx";


## fim12 import apps/desktop/src/renderer/features/editor/lsp/preparationTransport.ts hash=fdf954810c54fde9 cursorLine=30 
### history
@L16
-    if (!response.ok) throw new Error(response.error.message);
+    if (!response.ok) throw languageIpcError(response.error);
@L30
-    if (!response.ok) throw new Error(response.error.message);
+    if (!response.ok) throw languageIpcError(response.error);
### shown
@@ -34 +34,6 @@
 });
+
+const languageIpcError = (error: unknown) => {
+  if (error instanceof Error) return error;
+  return new Error(`Ipc error: ${JSON.stringify(error)}`);
+};

### expected
@@ -1 +1,2 @@
+import { languageIpcError } from "../../../../shared/languageError.ts";
 import type { LanguageApi } from "../../../../shared/api.ts";

