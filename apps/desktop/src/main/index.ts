import { createMainPredictionPlacement } from "./prediction/placement.ts";
import { PredictionSettings } from "./prediction/preferences.ts";
import { PredictionOutcomes, outcomeLogPath } from "./prediction/outcomes.ts";
import { predictionRestraints } from "../shared/predictionPlacement.ts";
import { createPredictionBridge } from "./prediction/bridge.ts";
/**
 * The Electron main process: the Client runtime (`@polaris/client`'s
 * HostRegistry on Effect), the typed IPC bridge, the menu and the window.
 *
 *   POLARIS_DESKTOP_USER_DATA=<dir>   settings and caches go here (tests, benchmarks)
 *   POLARIS_DESKTOP_HIDDEN=1          never show the window (smoke tests, benchmarks)
 *   ELECTRON_RENDERER_URL=<url>       dev: load the renderer from the Vite server
 *   POLARIS_DESKTOP_EXTRA_HOSTS=<json> screenshots and tests: [{ key, label, socket }] as more Hosts
 *   POLARIS_DESKTOP_LOCAL_LABEL=<name> the local Host's name (default clientCopy().localHost, "This Mac")
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { userPathAsync } from "@polaris/client/userPath";
import {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  nativeTheme,
  ipcMain,
  session,
  shell,
} from "electron";
import { type AppEvent, type Appearance, CHANNELS, type SessionDefault } from "../shared/api.ts";
import {
  clientIdentity,
  HostDirectory,
  type ClientRuntime,
  extraHosts,
  hostEntries,
  LOCAL_HOST_KEY,
  startClientRuntime,
  whenConnected,
} from "./hosts.ts";
import { Effect, Layer, Option } from "effect";
import { followFocus, followReviewRequests, githubLayer } from "./github/electron.ts";
import { legacyTokens } from "./github/store.ts";
import { secureStorageLayer } from "./secure/electron.ts";
import { SecureStorage } from "./secure/index.ts";
import { iconPng, nameApp, showIcon } from "./identity.ts";
import { registerIpc } from "./ipc/index.ts";
import { registerLanguageIpc } from "./ipc/languages.ts";
import { optionalLanguageCredential } from "./languages/optionalCredential.ts";
import { LanguageIdentityEpochs } from "./languages/identityEpochs.ts";
import { createMainLanguageApi } from "./languages/runtime.ts";
import { LanguagePreferences } from "./languages/settings.ts";
import { machinesLayer, sshAliasNames } from "./machines/index.ts";
import { LocalHost, type LocalHostApi } from "./local/index.ts";
import { buildMenu, popupAppMenu } from "./menu.ts";
import { setClientPlatform, toClientPlatform } from "../shared/platform.ts";
import { createNeedsYouCenter, type NeedsYouCenter } from "./notifications/index.ts";
import { createReviewNotifier, type ReviewNotifier } from "./notifications/reviews.ts";
import {
  APP_ORIGIN,
  applyDevCsp,
  isTrustedUrl,
  registerAppScheme,
  serveRenderer,
} from "./protocol.ts";
import { internetFetch } from "./net.ts";
import { distrustInSession } from "./tls/distrust.ts";
import { openPrices } from "./prices.ts";
import { openSnapshotCache } from "./snapshotCache.ts";
import type { SessionPrefsPatch } from "../shared/contract.ts";
import {
  appearanceOf,
  readSettings,
  sessionPrefsOf,
  type Settings,
  settingsPath,
  writeSettings,
} from "./settings.ts";
import { createMainWindow } from "./window.ts";
import { createDeepLinkInbox } from "./deepLinks.ts";
import { focusWindow } from "./notifications/focus.ts";
import { DEEP_LINK_SCHEME, deepLinkArg } from "../shared/deepLink.ts";
import { askToQuit, holdsQuit } from "./editorQuit.ts";
import { createAppUpdates, type AppUpdates } from "./updates/index.ts";
import { cannotInstallHere, installId } from "./updates/identity.ts";
import { revealAppPath, updatePlatform, windowsAppId } from "./updates/platform.ts";
import { handleSquirrelStartup } from "./updates/squirrel.ts";

if (await handleSquirrelStartup(process.platform, process.argv, process.execPath)) app.exit(0);

if (process.platform === "win32") app.setAppUserModelId(windowsAppId(process.arch));

const env = process.env;

// Launched from the Dock, the PATH is bare: adopt the terminal's, so `ssh` is the user's own.
const userPathReady =
  process.platform === "win32"
    ? Promise.resolve()
    : userPathAsync({ env }).then((path) => {
        env.PATH = path;
      });

const devUrl = env.ELECTRON_RENDERER_URL ?? null;

const dev = devUrl !== null || env.POLARIS_DESKTOP_DEV === "1";

/** `out/main/index.js` → the app root (`apps/desktop`, or `Resources/app` when bundled). */
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const repoRoot = join(appRoot, "../..");

nameApp();

if (env.POLARIS_DESKTOP_USER_DATA !== undefined) {
  app.setPath("userData", env.POLARIS_DESKTOP_USER_DATA);
}

// Screenshot runs draw another OS's chrome on this one; a release (app.asar) never pretends.
if (!app.getAppPath().endsWith(".asar") && env.POLARIS_DESKTOP_PLATFORM !== undefined) {
  setClientPlatform(toClientPlatform(env.POLARIS_DESKTOP_PLATFORM));
}

// The spike measured these as harmless and never needed: see ENG-184's NOTES.md.
app.commandLine.appendSwitch(
  "disable-features",
  "SpareRendererForSitePerProcess,MediaRouter,Translate,AutofillServerCommunication,OptimizationHints"
);

registerAppScheme();

if (!app.requestSingleInstanceLock()) app.exit(0);

const deepLinks = createDeepLinkInbox((line) => console.warn(line));

// macOS hands links over before `ready` too; the inbox holds them until the renderer loads.
app.on("open-url", (event, url) => {
  event.preventDefault();
  deepLinks.receive(url);
});

app.on("second-instance", (_event, argv) => {
  const url = deepLinkArg(argv);

  if (url !== null) deepLinks.receive(url);
});

const launchLink = deepLinkArg(process.argv);

if (launchLink !== null) deepLinks.receive(launchLink);

// Packaged only: a dev build claiming the scheme would take links from the installed app.
if (app.isPackaged && !dev) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);

let runtime: ClientRuntime | null = null;

const languageIdentities = new LanguageIdentityEpochs((hostKey) => {
  try {
    return (
      runtime?.runSync(HostDirectory.use((directory) => directory.connection(hostKey))) ?? null
    );
  } catch {
    return null;
  }
});

let languageRuntime: ReturnType<typeof createMainLanguageApi> | null = null;

let languageIpc: ReturnType<typeof registerLanguageIpc> | null = null;

/** Picked once for this platform: none on Windows on Arm (`LocalHost.unsupported`). */
let localHost: LocalHostApi | null = null;

let ipc: { readonly dispose: () => void } | null = null;

let predictionOutcomes: PredictionOutcomes | null = null;

let needsYou: NeedsYouCenter | null = null;

let reviews: ReviewNotifier | null = null;

let updates: AppUpdates | null = null;

let restartForUpdate = false;

/** Set once Polaris is quitting (⌘Q, the star's Quit): the window may then really close. */
let exiting = false;

const trusted = (url: string) => isTrustedUrl(url, devUrl);

const start = async () => {
  // Before any request: the GitHub client, updates and prices all use the default session.
  distrustInSession(session.defaultSession);
  showIcon({ repoRoot });
  await userPathReady;
  const file = settingsPath(app.getPath("userData"));
  let settings: Settings = readSettings(file);

  let proofHostKey: string | null = null;

  const appearance = (): Appearance => appearanceOf(settings);

  const updateSettings = (change: (current: Settings) => Settings) => {
    settings = change(settings);
    writeSettings({ path: file, settings });
  };

  const saveSettings = (patch: Partial<Settings>) =>
    updateSettings((current) => ({ ...current, ...patch }));

  const restartToUpdate = () => {
    if (updates?.get().phase !== "ready") return;
    restartForUpdate = true;
    app.quit();
  };

  const currentUpdates = createAppUpdates({
    native: autoUpdater,
    version: app.getVersion(),
    installId: installId(app.getPath("userData")),
    osVersion: process.getSystemVersion(),
    platform: process.platform,
    firstRun: process.platform === "win32" && process.argv.includes("--squirrel-firstrun"),
    fetch: internetFetch,
    arch: process.arch,
    supported: app.isPackaged && !dev && updatePlatform(process.platform, process.arch) !== null,
    blocked: cannotInstallHere(
      app.getAppPath(),
      app.getPath("downloads"),
      process.platform,
      process.execPath
    ),
    automatic: settings.automaticAppUpdates ?? true,
    lastCheckedAt: settings.appUpdateLastCheckedAt ?? null,
    save: saveSettings,
    publish: (value) => {
      applyAppearance();
      const event: AppEvent = { kind: "updates", updates: value };

      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
    },
  });

  updates = currentUpdates;

  const setAppearance = (patch: Partial<Appearance>) => {
    saveSettings(patch);
    applyAppearance();
  };

  const setSessionDefault = (harness: string, value: SessionDefault | null) => {
    const others = Object.entries(settings.sessionDefaults ?? {}).filter(([k]) => k !== harness);

    const sessionDefaults = Object.fromEntries(
      value === null ? others : [...others, [harness, value]]
    );

    saveSettings({ sessionDefaults });
    const event: AppEvent = { kind: "session-defaults", sessionDefaults };

    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
  };

  const setSessions = (patch: SessionPrefsPatch) => {
    const { newWorktree: _legacy, ...rest } = settings;

    updateSettings(() => ({ ...rest, sessions: { ...sessionPrefsOf(settings), ...patch } }));
    const event: AppEvent = { kind: "sessions", sessions: sessionPrefsOf(settings) };

    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
  };

  const chooseFolder = async (title: string, buttonLabel: string) => {
    const options: Electron.OpenDialogOptions = {
      title,
      buttonLabel,
      properties: ["openDirectory", "createDirectory"],
    };

    const win = BrowserWindow.getFocusedWindow();

    const picked = await (win === null
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(win, options));

    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  };

  const pickFolder = () => chooseFolder("Add a workspace", "Add workspace");

  const applyAppearance = () => {
    const current = appearance();
    const event: AppEvent = { kind: "appearance", appearance: current };

    nativeTheme.themeSource = current.theme;
    buildMenu({
      appearance: current,
      setAppearance,
      dev,
      proofHostKey,
      updates: currentUpdates.get(),
      checkUpdates: () => {
        currentUpdates.check();
      },
      restartToUpdate,
    });

    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
  };

  applyAppearance();

  const platformLocal = Effect.runSync(
    LocalHost.useSync((service) => service).pipe(
      Effect.provide(
        LocalHost.forPlatform(process.platform, {
          dev,
          repoRoot,
          env,
          label: env.POLARIS_DESKTOP_LOCAL_LABEL,
        })
      )
    )
  );

  // Resolving the local Daemon also says whether it runs the bench Harness (the proof session).
  const local: LocalHostApi = {
    ...platformLocal,
    resolve: Effect.tap(platformLocal.resolve, (daemon) =>
      Effect.sync(() => {
        proofHostKey = daemon.benchHarness ? LOCAL_HOST_KEY : null;
        applyAppearance();
      })
    ),
  };

  localHost = local;
  const localEnabled = local.supported && (settings.local?.enabled ?? true);
  const localDaemon = localEnabled ? await Effect.runPromise(local.resolve) : null;
  const userData = app.getPath("userData");

  const secureStorage = Layer.succeed(
    SecureStorage,
    await Effect.runPromise(
      Effect.provide(
        SecureStorage.useSync((storage) => storage),
        secureStorageLayer(userData, [legacyTokens(userData)])
      )
    )
  );

  const languageCredential = await Effect.runPromise(
    Effect.provide(
      optionalLanguageCredential(
        { legacyDirectory: join(userData, "language-private"), platform: process.platform },
        (message) => console.warn(message)
      ),
      secureStorage
    )
  );

  runtime = startClientRuntime(
    {
      entries: hostEntries({
        local: localDaemon,
        remotes: settings.hosts ?? [],
        extras: local.supported ? extraHosts(env.POLARIS_DESKTOP_EXTRA_HOSTS) : [],
        localLabel: local.label,
      }),
      identity: clientIdentity(app.getVersion()),
      ssh: settings.sshBinary === undefined ? {} : { sshBinary: settings.sshBinary },
      ...languageCredential,
      languageEpoch: (hostKey, session) =>
        languageIdentities.bind(hostKey, session)?.connectionEpoch ?? null,
      invalidateLanguage: (hostKey) => languageIdentities.invalidate(hostKey),
    },
    machinesLayer({
      settings: { get: () => settings, update: updateSettings },
      userData: app.getPath("userData"),
      appVersion: app.getVersion(),
      env,
      resources: app.isPackaged ? process.resourcesPath : null,
      repoRoot,
      dev,
      localHost: Layer.succeed(LocalHost, local),
    }),
    githubLayer({ userData, env, secureStorage })
  );
  languageRuntime = createMainLanguageApi({
    runtime,
    identities: languageIdentities,
    preferences: new LanguagePreferences(
      () => settings,
      (value) => updateSettings(() => value)
    ),
  });
  languageIpc = registerLanguageIpc(ipcMain, languageRuntime.api, trusted);
  followFocus(runtime);

  const predictionSettings = new PredictionSettings(
    () => settings,
    (value) => updateSettings(() => value),
    (hostKey, preferences) => {
      const event: AppEvent = {
        kind: "prediction-settings",
        hostKey,
        preferences,
        restraints: predictionRestraints(preferences.aggressiveness),
      };

      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
    }
  );

  predictionOutcomes = new PredictionOutcomes(outcomeLogPath(app.getPath("userData")));

  const predictionPlacement = createMainPredictionPlacement(runtime, predictionSettings);

  const predictionBridge = createPredictionBridge({
    runtime,
    placement: predictionPlacement,
    preferences: predictionSettings,
    read: () => settings,
    commit: (value) => updateSettings(() => value),
  });

  ipc = registerIpc({
    runtime,
    trusted,
    context: {
      updates: currentUpdates,
      restartToUpdate,
      showAppInFinder: () =>
        shell.showItemInFolder(revealAppPath(process.platform, app.getPath("exe"))),
      predictionSettings,
      predictionOutcomes,
      predictionPlacement,
      predictionBridge,
      chooseFolder,
      settings: () => settings,
      cache: openSnapshotCache(app.getPath("userData")),
      prices: openPrices(app.getPath("userData")),
      setAppearance,
      setSessionDefault,
      setSessions,
      openExternal: (url) => shell.openExternal(url),
      revealInFinder: (path) => shell.showItemInFolder(path),
      sshHosts: () => sshAliasNames(env),
      setWelcomeSeen: () => saveSettings({ welcomeSeen: true }),
      pickFolder,
      appVersion: app.getVersion(),
      proofWorkspace: () =>
        Option.exists(Effect.runSync(local.current), (daemon) => daemon.benchHarness)
          ? mkdtempSync(join(tmpdir(), "polaris-proof-"))
          : null,
      writeClipboard: async (text) => clipboard.writeText(text),
      // The one main window; a hidden one (smoke runs) has no focus to find it by.
      editAction: (action) =>
        (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents[
          action
        ](),
      needsYou: (summary) => needsYou?.publish(summary),
      showAppMenu: () => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

        if (win !== undefined) popupAppMenu(win);
      },
    },
  });

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );

  if (devUrl === null) serveRenderer(join(appRoot, "out/renderer"));
  else applyDevCsp(session.defaultSession, devUrl);

  const win = createMainWindow({
    url: devUrl ?? `${APP_ORIGIN}/index.html`,
    preload: join(appRoot, "out/preload/index.cjs"),
    trusted,
    show: env.POLARIS_DESKTOP_HIDDEN !== "1",
    icon: iconPng({ repoRoot }),
  });

  // macOS: closing the window hides it, so the star, notifications and badge keep counting.
  if (process.platform === "darwin") {
    win.on("close", (event) => {
      if (exiting) return;
      event.preventDefault();
      win.hide();
    });
    app.on("activate", () => win.show());
  }

  needsYou = createNeedsYouCenter({
    window: () => (win.isDestroyed() ? null : win),
    send: (event) => win.webContents.send(CHANNELS.app, event),
    notify: () => env.POLARIS_DESKTOP_HIDDEN !== "1" && sessionPrefsOf(settings).notifyNeedsYou,
    notifyTurns: () =>
      env.POLARIS_DESKTOP_HIDDEN !== "1" && sessionPrefsOf(settings).notifyTurnEnded,
    turnMinutes: () => {
      const prefs = sessionPrefsOf(settings);

      return prefs.notifyLongTurnsOnly ? prefs.longTurnMinutes : null;
    },
    notifyAgents: () => env.POLARIS_DESKTOP_HIDDEN !== "1",
  });

  win.webContents.on("did-start-loading", () => deepLinks.detach());
  win.webContents.on("did-finish-load", () =>
    deepLinks.attach({
      send: (event) => win.webContents.send(CHANNELS.app, event),
      focus: () => {
        if (env.POLARIS_DESKTOP_HIDDEN !== "1") focusWindow(win);
      },
    })
  );

  reviews = createReviewNotifier({
    window: () => (win.isDestroyed() ? null : win),
    send: (event) => win.webContents.send(CHANNELS.app, event),
    notify: () =>
      env.POLARIS_DESKTOP_HIDDEN !== "1" && sessionPrefsOf(settings).notifyReviewRequests,
  });
  followReviewRequests(runtime, reviews);
  currentUpdates.start();

  // Benchmarks and scripts wait for this line: the window is painted and the local Host is up.
  const shown = new Promise<void>((resolve) => win.once("ready-to-show", () => resolve()));

  const localUp = localEnabled ? runtime.runPromise(whenConnected(LOCAL_HOST_KEY)) : null;

  void Promise.all([shown, localUp]).then(() => console.log("polaris: ready"));
};

let quitting = false;

const finishQuit = () => {
  quitting = true;
  exiting = true;
  ipc?.dispose();
  languageIpc?.dispose();
  languageRuntime?.dispose();
  languageIdentities.dispose();
  needsYou?.dispose();
  reviews?.dispose();
  updates?.dispose();
  // The dev Daemon (if this app started it) goes down with the app.
  const stopLocal = localHost === null ? undefined : Effect.runPromise(localHost.stop);

  void Promise.allSettled([runtime?.dispose(), stopLocal, predictionOutcomes?.close()]).then(() => {
    if (restartForUpdate && updates?.get().phase === "ready") updates.install();
    else app.quit();
  });
};

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();

  // Cleanup precedes Squirrel closing windows; Editor cancellation leaves the app usable.
  if (holdsQuit()) {
    void askToQuit().then((go) => {
      if (go) finishQuit();
      else restartForUpdate = false;
    });
  } else finishQuit();
});

app.on("window-all-closed", () => app.quit());

app
  .whenReady()
  .then(start)
  .catch((cause: unknown) => {
    console.error("polaris: failed to start", cause);
    app.exit(1);
  });
