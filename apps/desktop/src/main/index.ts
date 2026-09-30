/**
 * The Electron main process: the Client runtime (`@polaris/client`'s
 * HostRegistry on Effect), the typed IPC bridge, the menu and the window.
 *
 *   POLARIS_DESKTOP_USER_DATA=<dir>   settings and caches go here (tests, benchmarks)
 *   POLARIS_DESKTOP_HIDDEN=1          never show the window (smoke tests, benchmarks)
 *   ELECTRON_RENDERER_URL=<url>       dev: load the renderer from the Vite server
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, nativeTheme, session } from "electron";
import { type AppEvent, type Appearance, CHANNELS } from "../shared/api.ts";
import {
  clientIdentity,
  type ClientRuntime,
  hostEntries,
  LOCAL_HOST_KEY,
  startClientRuntime,
  whenConnected,
} from "./hosts.ts";
import { registerIpc } from "./ipc/index.ts";
import { machinesLayer } from "./machines/index.ts";
import { type LocalDaemon, resolveLocalDaemon } from "./localDaemon.ts";
import { buildMenu } from "./menu.ts";
import {
  APP_ORIGIN,
  applyDevCsp,
  isTrustedUrl,
  registerAppScheme,
  serveRenderer,
} from "./protocol.ts";
import { openSnapshotCache } from "./snapshotCache.ts";
import { readSettings, type Settings, settingsPath, writeSettings } from "./settings.ts";
import { createMainWindow } from "./window.ts";

const env = process.env;

const devUrl = env.ELECTRON_RENDERER_URL ?? null;

const dev = devUrl !== null || env.POLARIS_DESKTOP_DEV === "1";

/** `out/main/index.js` → the app root (`apps/desktop`, or `Resources/app` when bundled). */
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const repoRoot = join(appRoot, "../..");

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

const trusted = (url: string) => isTrustedUrl(url, devUrl);

const start = async () => {
  const file = settingsPath(app.getPath("userData"));
  let settings: Settings = readSettings(file);

  const appearance = (): Appearance => ({
    theme: settings.theme ?? "system",
    density: settings.density ?? "calm",
  });

  const updateSettings = (change: (current: Settings) => Settings) => {
    settings = change(settings);
    writeSettings({ path: file, settings });
  };

  const setAppearance = (patch: Partial<Appearance>) => {
    updateSettings((current) => ({ ...current, ...patch }));
    applyAppearance();
  };

  const applyAppearance = () => {
    const current = appearance();
    const event: AppEvent = { kind: "appearance", appearance: current };

    nativeTheme.themeSource = current.theme;
    buildMenu({ appearance: current, setAppearance, dev });

    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
  };

  applyAppearance();

  const localEnabled = settings.local?.enabled ?? true;

  const startLocal = async () => {
    localDaemon ??= await resolveLocalDaemon({ dev, repoRoot, env });

    return localDaemon;
  };

  const local = localEnabled ? await startLocal() : null;

  runtime = startClientRuntime(
    {
      entries: hostEntries({ local, remotes: settings.hosts ?? [] }),
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
    })
  );

  const daemonDist = join(repoRoot, "apps/daemon/dist");

  ipc = registerIpc({
    runtime,
    trusted,
    context: {
      settings: () => settings,
      cache: openSnapshotCache(app.getPath("userData")),
      setAppearance,
      proofWorkspace: () =>
        localDaemon?.benchHarness === true ? mkdtempSync(join(tmpdir(), "polaris-proof-")) : null,
      daemonDist: existsSync(join(daemonDist, "manifest.json")) ? daemonDist : null,
      writeClipboard: async (text) => clipboard.writeText(text),
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
  });

  // Benchmarks and scripts wait for this line: the window is painted and the local Host is up.
  const shown = new Promise<void>((resolve) => win.once("ready-to-show", () => resolve()));

  const localUp = localEnabled ? runtime.runPromise(whenConnected(LOCAL_HOST_KEY)) : null;

  void Promise.all([shown, localUp]).then(() => console.log("polaris: ready"));
};

let quitting = false;

app.on("will-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  ipc?.dispose();
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
