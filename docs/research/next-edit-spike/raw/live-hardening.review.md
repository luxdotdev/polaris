# Live hardening review, 2026-10-15

Each raw output is labeled before guards. Only novel non-exact/non-abstaining outputs are expanded here; all 200 labels are in the fixture files. UTF-16 offsets are into the frozen request buffer. Display diffs omit trailing whitespace; raw JSON fixtures preserve it exactly.


## Sweep dev


### rf06: dangerous → abstain

`apps/desktop/src/renderer/features/editor/prediction/commands.ts`

Propagates unresolved acceptable into the healthy dismiss handler; history only changed accept handlers.

```diff
--- frozen input
+++ raw model output
@@ -25,3 +25,3 @@
       "editor.prediction.dismiss": {
-        enabled: available,
+        enabled: acceptable,
         run: () => {
```

Raw hunks: `[{"from":988,"to":992,"text":"ccept"}]`

Shown hunks after guards: `[]`


### dd03: dangerous → abstain

`apps/desktop/src/renderer/features/editor/runtime/editorState.ts`

Defines currentKeyPlatform despite the history importing that binding.

```diff
--- frozen input
+++ raw model output
@@ -47,3 +47,8 @@

-const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
+const currentKeyPlatform = () => {
+  if (typeof navigator !== "undefined") {
+    return /Mac/.test(navigator.userAgent) ? "mac" : "win";
+  }
+  return "win";
+};

```

Raw hunks: `[{"from":1795,"to":1797,"text":""},{"from":1798,"to":1798,"text":"urrentKeyPlatform"},{"from":1801,"to":1801,"text":"() => {\n  if ("},{"from":1833,"to":1833,"text":")"},{"from":1834,"to":1836,"text":"{\n"},{"from":1837,"to":1837,"text":"   return "},{"from":1868,"to":1868,"text":" ? \"mac\" : \"win\";\n  }\n  return \"win\";\n}"}]`

Shown hunks after guards: `[]`


### dd04: dangerous → abstain

`apps/desktop/src/renderer/features/settings/editor/Advanced.tsx`

Removes the healthy button and its accessibility attributes while replacing the chevron.

```diff
--- frozen input
+++ raw model output
@@ -99,14 +99,12 @@
     <section aria-label="Advanced" className="flex flex-col gap-4">
-      <button
-        type="button"
-        aria-expanded={open}
+      <DisclosureChevron
+        open={open}
+        size={12}
+        className="text-text-subtle"
         onClick={() => setOpen(!open)}
-        className="flex cursor-default items-center gap-2 self-start px-0.5 py-1 text-left"
-      >
-        <DisclosureChevron open={open} size={12} className="text-text-subtle" />
-        <span className="text-body text-text-default font-medium">Advanced</span>
-        <span className="text-caption text-text-faint">
-          Custom language servers and executable overrides, per host
-        </span>
-      </button>
+      />
+      <span className="text-body text-text-default font-medium">Advanced</span>
+      <span className="text-caption text-text-faint">
+        Custom language servers and executable overrides, per host
+      </span>
       {open &&
```

Raw hunks: `[{"from":3191,"to":3192,"text":"Disclos"},{"from":3193,"to":3195,"text":"reChevr"},{"from":3206,"to":3208,"text":"o"},{"from":3210,"to":3210,"text":"n"},{"from":3211,"to":3216,"text":"{"},{"from":3217,"to":3217,"text":"pe"},{"from":3218,"to":3219,"text":"}"},{"from":3228,"to":3230,"text":"s"},{"from":3231,"to":3233,"text":"z"},{"from":3234,"to":3236,"text":"={12}\n        cl"},{"from":3237,"to":3239,"text":"ssNam"},{"from":3240,"to":3241,"text":""},{"from":3242,"to":3245,"text":"\"t"},{"from":3246,"to":3248,"text":"xt-text-subtle\""},{"from":3294,"to":3466,"text":""},{"from":3475,"to":3477,"text":""},{"from":3557,"to":3559,"text":""},{"from":3615,"to":3617,"text":""},{"from":3682,"to":3684,"text":""},{"from":3689,"to":3705,"text":""}]`

Shown hunks after guards: `[]`


### dd06: dangerous → abstain

`apps/desktop/src/renderer/features/review/ui/Queue.tsx`

Borderline, conservatively dangerous: rewrites the obsolete modifier declarations with inverted conditions instead of removing them.

```diff
--- frozen input
+++ raw model output
@@ -46,4 +46,4 @@
   useEffect(() => {
-    const alt = digitModifiersFor(currentKeyPlatform())[0] === "Alt";
-    const key = alt ? "Alt" : "Control";
+    const ctrl = digitModifiersFor(currentKeyPlatform())[0] === "Control";
+    const key = ctrl ? "Control" : "Alt";

```

Raw hunks: `[{"from":2012,"to":2014,"text":"c"},{"from":2015,"to":2015,"text":"rl"},{"from":2066,"to":2068,"text":"Con"},{"from":2069,"to":2069,"text":"rol"},{"from":2088,"to":2090,"text":"c"},{"from":2091,"to":2091,"text":"rl"},{"from":2095,"to":2103,"text":""},{"from":2110,"to":2110,"text":"\" : \"Alt"}]`

Shown hunks after guards: `[]`


### im02: dangerous → abstain

`apps/daemon/src/transport/hostInfo.ts`

Rewrites the user-written VERSION reference to an environment fallback.

```diff
--- frozen input
+++ raw model output
@@ -9,3 +9,3 @@
 /** The Daemon's version; `polaris version` and `hello` report it. */
-export const DAEMON_VERSION = VERSION;
+export const DAEMON_VERSION = process.env.VERSION || "0.0.0";

```

Raw hunks: `[{"from":440,"to":440,"text":"process.env."},{"from":447,"to":447,"text":" || \"0.0.0\""}]`

Shown hunks after guards: `[]`


### im03: dangerous → abstain

`apps/daemon/src/files/trash.ts`

Deletes the healthy template literal closing backtick.

```diff
--- frozen input
+++ raw model output
@@ -15,3 +15,3 @@
   }
-}`;
+};

```

Raw hunks: `[{"from":646,"to":647,"text":""}]`

Shown hunks after guards: `[]`


### im04: dangerous → abstain

`apps/daemon/src/harness/registry.ts`

Deletes binary and the user-written expression, replacing them with an unrelated which implementation.

```diff
--- frozen input
+++ raw model output
@@ -25,4 +25,11 @@

-const binary = (env: string, name: string): string | null =>
-  process.env[env] || which(name) || null;
+const which = (name: string): string | null => {
+  const path = process.env.PATH || "";
+  const paths = path.split(":");
+  for (const path of paths) {
+    const executable = `${path}/${name}`;
+    if (Bun.which(executable)) return executable;
+  }
+  return null;
+};

```

Raw hunks: ``[{"from":1374,"to":1375,"text":"wh"},{"from":1376,"to":1380,"text":"ch"},{"from":1384,"to":1385,"text":""},{"from":1386,"to":1398,"text":""},{"from":1428,"to":1428,"text":" {"},{"from":1431,"to":1431,"text":"const "},{"from":1432,"to":1432,"text":"ath = p"},{"from":1442,"to":1447,"text":".PATH"},{"from":1451,"to":1452,"text":"\"\";\n  const pat"},{"from":1453,"to":1453,"text":"s = path.spl"},{"from":1454,"to":1454,"text":"t(\":\");\n  for ("},{"from":1455,"to":1455,"text":"onst pat"},{"from":1456,"to":1457,"text":" of paths) {\n    co"},{"from":1458,"to":1458,"text":"st execut"},{"from":1459,"to":1459,"text":"ble = `${path}/${na"},{"from":1461,"to":1461,"text":"}`;\n    if (Bun.which(executable"},{"from":1462,"to":1462,"text":")"},{"from":1463,"to":1465,"text":"return"},{"from":1466,"to":1466,"text":"executable;\n  }\n  retur"},{"from":1467,"to":1467,"text":" n"},{"from":1470,"to":1470,"text":";\n}"}]``

Shown hunks after guards: `[]`


### in01: wrong → wrong

`apps/daemon/src/constellation/setup/process.ts`

Completes the new env expression with the function value instead of invoking childEnv.

```diff
--- frozen input
+++ raw model output
@@ -28,3 +28,3 @@
           cwd: run.cwd,
-          env: c
+          env: childEnv,
           stdin: "ignore",
```


### in04: wrong → wrong

`apps/desktop/src/renderer/features/constellation/model/attention.ts`

Invents an outcome case rather than the setup case; existing cases are intact.

```diff
--- frozen input
+++ raw model output
@@ -29,3 +29,4 @@
         return { taskId: id, text: `${id} stopped without claiming`, rank: 4 };
-      case
+      case "outcome":
+        return { taskId: id, text: `${id} has an outcome`, rank: 5 };
     }
```


### hdd04: dangerous → abstain

`apps/daemon/src/languages/media/native.ts`

Adds os arguments to the newly written libcPath call and the unrelated healthy libraryPath call.

```diff
--- frozen input
+++ raw model output
@@ -24,3 +24,3 @@

-  return libcPath();
+  return libcPath(os);
 }
@@ -29,3 +29,3 @@
 const load = () =>
-  dlopen(libraryPath(), {
+  dlopen(libraryPath(os), {
     openat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
```

Raw hunks: `[{"from":800,"to":800,"text":"os"},{"from":928,"to":928,"text":"os"}]`

Shown hunks after guards: `[]`


### hdd05: dangerous → abstain

`apps/daemon/src/files/search/fallback.ts`

Changes the newly written close call and healthy synchronous stop function to async.

```diff
--- frozen input
+++ raw model output
@@ -307,5 +307,5 @@

-      const stop = () => {
+      const stop = async () => {
         clearTimeout(timer);
-        close();
+        await close();
         watchers.delete(stop);
```

Raw hunks: `[{"from":9439,"to":9439,"text":"async "},{"from":9484,"to":9484,"text":"await "}]`

Shown hunks after guards: `[]`


### hdd06: dangerous → abstain

`apps/desktop/src/renderer/features/jump/run.ts`

Replaces a healthy closing brace with a duplicate import while deleting the dead declaration.

```diff
--- frozen input
+++ raw model output
@@ -32,3 +32,3 @@
   );
-};
+import { useApp } from "../../shell/hooks.ts";

@@ -36,3 +36,2 @@
   const actions = useShellActions();
-  const commands = useCommands();
   const { topBar } = useSelection();
```

Raw hunks: `[{"from":1306,"to":1306,"text":"import { useApp "},{"from":1307,"to":1307,"text":" from \"../../shell/hooks.ts\""},{"from":1381,"to":1415,"text":""}]`

Shown hunks after guards: `[]`


### him04: dangerous → abstain

`apps/daemon/src/git/GitRpcs.ts`

Replaces the user-written watchGit call with an undefined handleGitWatch.

```diff
--- frozen input
+++ raw model output
@@ -173,3 +173,3 @@
   "git.commit": handleGitCommit,
-  "git.watch": ({ cwd }) => watchGit(cwd),
+  "git.watch": handleGitWatch,
 });
```

Raw hunks: `[{"from":5387,"to":5404,"text":""},{"from":5405,"to":5405,"text":"andle"},{"from":5408,"to":5409,"text":"Wat"},{"from":5410,"to":5413,"text":"h"}]`

Shown hunks after guards: `[]`


### hin02: dangerous → abstain

`apps/desktop/src/renderer/features/risk/ui/VerdictPopover.tsx`

Rewrites the newly written shown reference into a conflicting self-reference and parameter binding.

```diff
--- frozen input
+++ raw model output
@@ -134,3 +134,4 @@
   onSave,
-  open:
+  open,
+  onOpenChange,
 }: {
@@ -143,3 +144,3 @@
   const [own, setOwn] = useState(false);
-  const open = shown ?? own;
+  const open = open ?? own;
   const setOpen = onOpenChange ?? setOwn;
```

Raw hunks: `[{"from":4056,"to":4057,"text":",\n  onOpenChange,"},{"from":4382,"to":4384,"text":""},{"from":4385,"to":4386,"text":"pe"}]`

Shown hunks after guards: `[]`


### hin03: wrong → wrong

`apps/desktop/src/main/index.ts`

Completes the new showAppMenu callback without the required window argument.

```diff
--- frozen input
+++ raw model output
@@ -334,3 +334,3 @@
       needsYou: (summary) => needsYou?.publish(summary),
-      showAppM
+      showAppMenu: () => popupAppMenu(),
     },
```


### hin04: wrong → wrong

`apps/desktop/scripts/package.ts`

Completes the new version expression with a function value instead of calling windowsPackageVersion.

```diff
--- frozen input
+++ raw model output
@@ -59,3 +59,3 @@

-const version = windows ? windowsP
+const version = windows ? windowsPackageVersion : pkg.version;
 if (release) {
```


### hin06: wrong → wrong

`apps/desktop/src/renderer/features/session/ui/items.tsx`

New menu attributes use the wrong change kind and an unsupported line property; existing code is intact.

```diff
--- frozen input
+++ raw model output
@@ -71,3 +71,4 @@
         className="group/file hover:bg-fill-hover h-row flex items-center pr-1"
-        data-menu-path={change.kind
+        data-menu-path={change.kind === "add" ? change.path : undefined}
+        data-menu-line={change.kind === "add" ? undefined : change.line}
       >
```


### hin08: wrong → wrong

`apps/daemon/src/store/eventJson.ts`

New decoder accepts only the literal any and omits known; existing code is intact.

```diff
--- frozen input
+++ raw model output
@@ -9,3 +9,4 @@

-const anyTag = Schema.decodeUnkn
+const anyTag = Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.Literals(["any"]) }));
+
 const codecs = new Map<DomainEvent["_tag"], ReturnType<typeof json<DomainEvent, unknown>>>();
```


### hrf06: dangerous → abstain

`apps/desktop/src/main/updates/identity.ts`

Changes healthy win32 path handling to posix while also fixing the unresolved resolve call.

```diff
--- frozen input
+++ raw model output
@@ -41,4 +41,4 @@
     return (
-      !/^app-\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/i.test(win32.basename(folder)) ||
-      !exists(win32.resolve(folder, "../Update.exe"))
+      !/^app-\d+\.\d+\.\d+(?:[-.][\w.-]+)?$/i.test(posix.basename(folder)) ||
+      !exists(posix.resolve(folder, "../Update.exe"))
     );
@@ -46,3 +46,3 @@

-  const path = resolve(appPath);
+  const path = posix.resolve(appPath);

```

Raw hunks: `[{"from":1383,"to":1384,"text":"pos"},{"from":1385,"to":1388,"text":"x"},{"from":1424,"to":1425,"text":"pos"},{"from":1426,"to":1429,"text":"x"},{"from":1491,"to":1491,"text":"posix."}]`

Shown hunks after guards: `[]`


## Sweep test


### hrn10: wrong → abstain

`apps/daemon/src/reviewer/index.ts`

Invents a canRunChecks service method passing a Workspace id instead of a Harness; leaves existing code intact.

```diff
--- frozen input
+++ raw model output
@@ -246,2 +246,3 @@
       setSettings: (settings) => saveSettings(path, settings),
+      canRunChecks: (workspaceId) => canRunChecks(workspaceId),
     });
```


### hrn14: dangerous → abstain

`apps/desktop/src/renderer/features/editor/status/LogTab.tsx`

Changes the user-written version(tools, providerId) into version(tools, "server") and rewrites an unrelated condition.

```diff
--- frozen input
+++ raw model output
@@ -93,3 +93,3 @@
   useLiveLog(hostKey, runtime);
-  const server = version(tools, providerId);
+  const server = version(tools, "server");
   const typescript = version(tools, "typescript");
@@ -97,3 +97,4 @@
   const typescriptDetail =
-    providerId !== "typescript-language-server" || trust === null
+    "typescript-language-server" !== providerId ||
+    trust === null
       ? null
```

Raw hunks: `[{"from":3157,"to":3158,"text":"\"se"},{"from":3159,"to":3160,"text":""},{"from":3161,"to":3163,"text":""},{"from":3165,"to":3167,"text":"\""},{"from":3253,"to":3268,"text":""},{"from":3297,"to":3297,"text":"!== providerId "},{"from":3299,"to":3299,"text":"\n   "}]`

Shown hunks after guards: `[]`


### hin11: acceptable → acceptable

`apps/desktop/src/main/machines/index.ts`

Correct partial continuation of platform forwarding, including its process.platform fallback; the subsequent sshBinary property remains to be typed.

```diff
--- frozen input
+++ raw model output
@@ -59,3 +59,3 @@
   Machines.layer({
-    platform: input.pl
+    platform: input.platform ?? process.platform,
     settings: input.settings,
```


### hin12: dangerous → abstain

`apps/daemon/src/languages/composition/managedAvailability.ts`

Deletes the healthy managed-provider, phase, admission and settings eligibility checks.

```diff
--- frozen input
+++ raw model output
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
+  if (developerProvider.includes(toolId) || managedProviders.has(toolId)) {
     return installation.inspect(
```

Raw hunks: `[{"from":1348,"to":1368,"text":"r"},{"from":1376,"to":1377,"text":""},{"from":1378,"to":1380,"text":"include"},{"from":1392,"to":1393,"text":""},{"from":1394,"to":1424,"text":""},{"from":1431,"to":1441,"text":"Prov"},{"from":1442,"to":1444,"text":""},{"from":1445,"to":1453,"text":"ers.h"},{"from":1454,"to":1457,"text":""},{"from":1458,"to":1460,"text":"(t"},{"from":1461,"to":1469,"text":"olI"},{"from":1470,"to":1509,"text":""},{"from":1510,"to":1510,"text":") {"}]`

Shown hunks after guards: `[]`


### hin13: wrong → abstain

`apps/desktop/src/main/index.ts`

New createPredictionBridge options use settings instead of preferences and omit read/commit.

```diff
--- frozen input
+++ raw model output
@@ -327,3 +327,8 @@

-  const predictionBrid
+  const predictionBridge = createPredictionBridge({
+    runtime,
+    settings: predictionSettings,
+    placement: predictionPlacement,
+  });
+
   ipc = registerIpc({
```


### hin14: wrong → abstain

`apps/desktop/src/main/index.ts`

New placement factory call receives settings callbacks instead of runtime and PredictionSettings.

```diff
--- frozen input
+++ raw model output
@@ -319,3 +319,10 @@

-  const predictionSett
+  const predictionSettings = new PredictionSettings(
+    () => settings,
+    (value) => updateSettings(() => value)
+  );
+  const predictionPlacement = createMainPredictionPlacement(
+    () => settings,
+    (value) => updateSettings(() => value)
+  );
   ipc = registerIpc({
```


### hrf13: dangerous → abstain

`apps/desktop/src/renderer/routes/selection.ts`

Changes the user-authored input.models call and unrelated resolveSelection destructuring while leaving the intended pickWorkspace binding unresolved.

```diff
--- frozen input
+++ raw model output
@@ -215,3 +215,3 @@
   const input = { ...raw, nav: followSession(raw) };
-  const { nav, bar } = input;
+  const { nav, bar, models } = input;

@@ -223,3 +223,3 @@
     bar.some((h) => h.host.key === nav.hostKey) &&
-    isRegistered(input.models, nav.hostKey, nav.workspaceId);
+    isRegistered(models, nav.hostKey, nav.workspaceId);

```

Raw hunks: `[{"from":6853,"to":6853,"text":", models"},{"from":7223,"to":7229,"text":""}]`

Shown hunks after guards: `[]`


## Zeta dev


### rn07: wrong → wrong

`apps/desktop/src/renderer/features/review/data/pierre.tsx`

Uses only THEMES.dark instead of the dark/light mapping requested by the history.

```diff
--- frozen input
+++ raw model output
@@ -24,3 +24,3 @@
 const highlighterOptions = {
-  theme: THEME_NAME,
+  theme: THEMES.dark,
   lineDiffType: "word-alt" as const,
```


### rf06: wrong → wrong

`apps/desktop/src/renderer/features/editor/prediction/commands.ts`

Adds a new acceptable helper that merely calls available and omits the provisional check.

```diff
--- frozen input
+++ raw model output
@@ -13,2 +13,6 @@
       return view !== undefined && view.hasFocus && visibleGhost(view.state) !== null;
+    };
+
+    const acceptable = () => {
+      return available();
     };
```


### im04: wrong → wrong

`apps/daemon/src/harness/registry.ts`

Adds an empty which implementation instead of the missing import; does not replace binary.

```diff
--- frozen input
+++ raw model output
@@ -27,2 +27,6 @@
   process.env[env] || which(name) || null;
+
+const which = (name: string): string | null => {
+
+};

```


### in01: dangerous → abstain

`apps/daemon/src/constellation/setup/process.ts`

Changes the healthy closing brace to an extra parenthesis while completing env.

```diff
--- frozen input
+++ raw model output
@@ -20,3 +20,3 @@
   return text + decoder.decode();
-};
+});

@@ -28,3 +28,3 @@
           cwd: run.cwd,
-          env: c
+          env: childEnv(run.cwd),
           stdin: "ignore",
```

Raw hunks: `[{"from":623,"to":623,"text":")"},{"from":896,"to":896,"text":"hildEnv(run.cwd),"}]`

Shown hunks after guards: `[]`


### in04: wrong → wrong

`apps/desktop/src/renderer/features/constellation/model/attention.ts`

New setup case has an unfinished rank expression and omits setupOutcome.

```diff
--- frozen input
+++ raw model output
@@ -29,3 +29,4 @@
         return { taskId: id, text: `${id} stopped without claiming`, rank: 4 };
-      case
+      case "setup":
+        return { taskId: id, text: `${id} needs setup`, rank:  };
     }
```


### hdd06: dangerous → abstain

`apps/desktop/src/renderer/features/jump/run.ts`

Deletes the healthy isReviewTarget condition and runReviewTarget call, leaving its return and closing brace.

```diff
--- frozen input
+++ raw model output
@@ -36,3 +36,2 @@
   const actions = useShellActions();
-  const commands = useCommands();
   const { topBar } = useSelection();
@@ -42,5 +41,2 @@
   return (target: JumpTarget, review: boolean) => {
-    if (isReviewTarget(target)) {
-      runReviewTarget(target, actions);
-
       return;
```

Raw hunks: `[{"from":1381,"to":1415,"text":""},{"from":1591,"to":1666,"text":""}]`

Shown hunks after guards: `[]`


### hin01: wrong → wrong

`apps/desktop/scripts/dmg.ts`

New resolveSigning invocation omits the required credentials argument.

```diff
--- frozen input
+++ raw model output
@@ -14,3 +14,3 @@

-const signing = resolveSig
+const signing = resolveSigning();
 console.log(
```


### hin03: wrong → wrong

`apps/desktop/src/main/index.ts`

New popupAppMenu invocation omits the required BrowserWindow argument.

```diff
--- frozen input
+++ raw model output
@@ -334,3 +334,3 @@
       needsYou: (summary) => needsYou?.publish(summary),
-      showAppM
+      showAppMenu: () => popupAppMenu(),
     },
```


### hin04: wrong → wrong

`apps/desktop/scripts/package.ts`

New windowsPackageVersion invocation omits the required release argument and its validation.

```diff
--- frozen input
+++ raw model output
@@ -59,3 +59,3 @@

-const version = windows ? windowsP
+const version = windows ? windowsPackageVersion(pkg.version) : pkg.version;
 if (release) {
```


### hin06: acceptable → acceptable

`apps/desktop/src/renderer/features/session/ui/items.tsx`

Useful partial continuation: correct path attribute; React omits null as it omits undefined. The separate diff attribute remains to be typed.

```diff
--- frozen input
+++ raw model output
@@ -71,3 +71,3 @@
         className="group/file hover:bg-fill-hover h-row flex items-center pr-1"
-        data-menu-path={change.kind
+        data-menu-path={change.kind === "delete" ? null : change.path}
       >
```


### hin07: acceptable → acceptable

`apps/desktop/src/renderer/features/machines/HostsSettingsPage.tsx`

Useful partial continuation: completes the correct useWslDistros destructuring. The next onWindows declaration remains to be typed.

```diff
--- frozen input
+++ raw model output
@@ -117,3 +117,4 @@
   const machines = useMachines();
-  const { wsl, aga
+  const { wsl, again } = useWslDistros();
+
   const [adder, setAdder] = useState(adding);
```


### hin08: wrong → wrong

`apps/daemon/src/store/eventJson.ts`

New anyTag decoder repeats the narrow known-tag decoder and omits the known set.

```diff
--- frozen input
+++ raw model output
@@ -9,3 +9,3 @@

-const anyTag = Schema.decodeUnkn
+const anyTag = Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.Literals(kinds) }));
 const codecs = new Map<DomainEvent["_tag"], ReturnType<typeof json<DomainEvent, unknown>>>();
```


### hrf06: acceptable → acceptable

`apps/desktop/src/main/updates/identity.ts`

Performs the intended posix.resolve refactor; differs from the commit only by omitting its explanatory comment.

```diff
--- frozen input
+++ raw model output
@@ -46,3 +46,3 @@

-  const path = resolve(appPath);
+  const path = posix.resolve(appPath);

```


## Zeta test


### hin11: acceptable → acceptable

`apps/desktop/src/main/machines/index.ts`

Useful partial continuation: forwards platform to optional MachinesInput.platform. The explicit fallback and subsequent sshBinary line remain to be typed.

```diff
--- frozen input
+++ raw model output
@@ -59,3 +59,3 @@
   Machines.layer({
-    platform: input.pl
+    platform: input.platform,
     settings: input.settings,
```


### hin12: wrong → wrong

`apps/daemon/src/languages/composition/managedAvailability.ts`

New branch calls developerAvailability with the wrong signature and tests its return instead of developerProvider.

```diff
--- frozen input
+++ raw model output
@@ -33,3 +33,11 @@
 ) => {
-  if (develope
+  if (developerAvailability(toolId, phase, trusted, admission, settings) === undefined) {
+    return installation.inspect(
+      toolId,
+      phase,
+      trusted || (managedProviders.has(toolId) && managed !== undefined),
+      admission
+    );
+  }
+
   if (
```


### hin13: wrong → abstain

`apps/desktop/src/main/index.ts`

New createPredictionBridge call omits its required dependency object.

```diff
--- frozen input
+++ raw model output
@@ -327,3 +327,3 @@

-  const predictionBrid
+  const predictionBridge = createPredictionBridge();
   ipc = registerIpc({
```


### hin14: wrong → abstain

`apps/desktop/src/main/index.ts`

New PredictionSettings and createMainPredictionPlacement calls omit required dependencies.

```diff
--- frozen input
+++ raw model output
@@ -319,3 +319,4 @@

-  const predictionSett
+  const predictionSettings = new PredictionSettings();
+  const predictionPlacement = createMainPredictionPlacement();
   ipc = registerIpc({
```
