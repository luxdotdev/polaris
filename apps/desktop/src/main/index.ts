/**
 * The Electron main process: the Client runtime (`@polaris/client`'s
 * HostRegistry on Effect), the typed IPC bridge, the menu and the window.
 *
 *   POLARIS_DESKTOP_USER_DATA=<dir>   settings and caches go here (tests, benchmarks)
 *   POLARIS_DESKTOP_HIDDEN=1          never show the window (smoke tests, benchmarks)
 *   ELECTRON_RENDERER_URL=<url>       dev: load the renderer from the Vite server
 *   POLARIS_DESKTOP_EXTRA_HOSTS=<json> screenshots and tests: [{ key, label, socket }] as more Hosts
 *   POLARIS_DESKTOP_LOCAL_LABEL=<name> the local Host's name (default "This Mac")
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, dialog, nativeTheme, session, shell } from "electron";
import { type AppEvent, type Appearance, CHANNELS, type SessionDefault } from "../shared/api.ts";
import {
  clientIdentity,
  type ClientRuntime,
  extraHosts,
  hostEntries,
  LOCAL_HOST_KEY,
  startClientRuntime,
  whenConnected,
} from "./hosts.ts";
import { iconPng, nameApp, showIcon } from "./identity.ts";
import { registerIpc } from "./ipc/index.ts";
import { machinesLayer, sshAliasNames } from "./machines/index.ts";
import { type LocalDaemon, resolveLocalDaemon } from "./localDaemon.ts";
import { buildMenu } from "./menu.ts";
import { createNeedsYouCenter, type NeedsYouCenter } from "./notifications/index.ts";
import {
  APP_ORIGIN,
  applyDevCsp,
  isTrustedUrl,
  registerAppScheme,
  serveRenderer,
} from "./protocol.ts";
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

const env = process.env;

const devUrl = env.ELECTRON_RENDERER_URL ?? null;

const dev = devUrl !== null || env.POLARIS_DESKTOP_DEV === "1";

/** `out/main/index.js` → the app root (`apps/desktop`, or `Resources/app` when bundled). */
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const repoRoot = join(appRoot, "../..");

nameApp();

if (env.POLARIS_DESKTOP_USER_DATA !== undefined) {
  app.setPath("userData", env.POLARIS_DESKTOP_USER_DATA);
}

// The spike measured these as harmless and never needed: see ENG-184's NOTES.md.
app.commandLine.appendSwitch(
  "disable-features",
  "SpareRendererForSitePerProcess,MediaRouter,Translate,AutofillServerCommunication,OptimizationHints"
);

registerAppScheme();

if (!app.requestSingleInstanceLock()) app.exit(0);

let runtime: ClientRuntime | null = null;

let localDaemon: LocalDaemon | null = null;

let ipc: { readonly dispose: () => void } | null = null;

let needsYou: NeedsYouCenter | null = null;

/** Set once Polaris is quitting (⌘Q, the star's Quit): the window may then really close. */
let exiting = false;

const trusted = (url: string) => isTrustedUrl(url, devUrl);

const localLabel = (label: string | undefined): { localLabel?: string } =>
  label === undefined || label === "" ? {} : { localLabel: label };

const start = async () => {
  showIcon({ repoRoot });
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

  const pickFolder = async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Add a workspace",
      buttonLabel: "Add workspace",
      properties: ["openDirectory", "createDirectory"],
    };

    const win = BrowserWindow.getFocusedWindow();

    const picked = await (win === null
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(win, options));

    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  };

  const applyAppearance = () => {
    const current = appearance();
    const event: AppEvent = { kind: "appearance", appearance: current };

    nativeTheme.themeSource = current.theme;
    buildMenu({ appearance: current, setAppearance, dev, proofHostKey });

    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
  };

  applyAppearance();

  const localEnabled = settings.local?.enabled ?? true;

  const startLocal = async () => {
    localDaemon ??= await resolveLocalDaemon({ dev, repoRoot, env });
    proofHostKey = localDaemon.benchHarness ? LOCAL_HOST_KEY : null;
    applyAppearance();

    return localDaemon;
  };

  const local = localEnabled ? await startLocal() : null;

  runtime = startClientRuntime(
    {
      entries: hostEntries({
        local,
        remotes: settings.hosts ?? [],
        extras: extraHosts(env.POLARIS_DESKTOP_EXTRA_HOSTS),
        ...localLabel(env.POLARIS_DESKTOP_LOCAL_LABEL),
      }),
      identity: clientIdentity(app.getVersion()),
    },
    machinesLayer({
      settings: { get: () => settings, update: updateSettings },
      userData: app.getPath("userData"),
      env,
      resources: app.isPackaged ? process.resourcesPath : null,
      repoRoot,
      dev,
      localDaemon: startLocal,
      localHome: () => localDaemon?.installedHome ?? null,
    })
  );

  const daemonDist = join(repoRoot, "apps/daemon/dist");

  ipc = registerIpc({
    runtime,
    trusted,
    context: {
      settings: () => settings,
      cache: openSnapshotCache(app.getPath("userData")),
      prices: openPrices(app.getPath("userData")),
      setAppearance,
      setSessionDefault,
      setSessions,
      openExternal: (url) => shell.openExternal(url),
      sshHosts: () => sshAliasNames(env),
      setWelcomeSeen: () => saveSettings({ welcomeSeen: true }),
      pickFolder,
      appVersion: app.getVersion(),
      proofWorkspace: () =>
        localDaemon?.benchHarness === true ? mkdtempSync(join(tmpdir(), "polaris-proof-")) : null,
      daemonDist: existsSync(join(daemonDist, "manifest.json")) ? daemonDist : null,
      writeClipboard: async (text) => clipboard.writeText(text),
      needsYou: (summary) => needsYou?.publish(summary),
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
  });

  // Benchmarks and scripts wait for this line: the window is painted and the local Host is up.
  const shown = new Promise<void>((resolve) => win.once("ready-to-show", () => resolve()));

  const localUp = localEnabled ? runtime.runPromise(whenConnected(LOCAL_HOST_KEY)) : null;

  void Promise.all([shown, localUp]).then(() => console.log("polaris: ready"));
};

let quitting = false;

app.on("before-quit", () => {
  exiting = true;
});

app.on("will-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  ipc?.dispose();
  needsYou?.dispose();
  // The dev Daemon (if this app started it) goes down with the app.
  void Promise.allSettled([runtime?.dispose(), localDaemon?.stop()]).then(() => app.exit(0));
});

app.on("window-all-closed", () => app.quit());

app
  .whenReady()
  .then(start)
  .catch((cause: unknown) => {
    console.error("polaris: failed to start", cause);
    app.exit(1);
  });
