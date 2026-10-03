import type { AutoUpdater } from "electron";
import type { AppUpdateView } from "../../shared/appUpdates.ts";

export const UPDATE_BASE_URL = "https://polaris.lux.dev";

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type UpdateHeaders = {
  readonly "X-Polaris-macOS-Version": string;
  "X-Polaris-Install-ID"?: string;
};

export interface UpdateInput {
  readonly native: Pick<
    AutoUpdater,
    "on" | "removeListener" | "setFeedURL" | "checkForUpdates" | "quitAndInstall"
  >;
  readonly version: string;
  readonly installId: string;
  readonly macOSVersion: string;
  readonly arch: string;
  readonly supported: boolean;
  readonly blocked: boolean;
  readonly automatic: boolean;
  readonly lastCheckedAt: number | null;
  readonly save: (change: {
    automaticAppUpdates?: boolean;
    appUpdateLastCheckedAt?: number;
  }) => void;
  readonly publish: (view: AppUpdateView) => void;
  readonly now?: () => number;
  readonly schedule?: (run: () => void, delay: number) => () => void;
}

const scheduleCheck = (run: () => void, delay: number) => {
  const timer = setTimeout(run, delay);
  timer.unref();

  return () => clearTimeout(timer);
};

/** The asset name is authoritative; a Release title can be arbitrary prose. */
export const versionFromAsset = (url: string): string | null =>
  /\/Polaris-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-arm64-mac\.zip$/.exec(url)?.[1] ??
  null;

export const createAppUpdates = (input: UpdateInput) => {
  const now = input.now ?? Date.now;
  const schedule = input.schedule ?? scheduleCheck;
  let cancelTimer: (() => void) | null = null;
  let disposed = false;

  let view: AppUpdateView = {
    phase: input.supported && input.blocked ? "blocked" : "idle",
    version: input.version,
    availableVersion: null,
    automatic: input.automatic,
    lastCheckedAt: input.lastCheckedAt,
    installId: input.installId,
    macOSVersion: input.macOSVersion,
    arch: input.arch,
    supported: input.supported,
  };

  const change = (patch: Partial<AppUpdateView>) => {
    if (disposed) return;
    view = { ...view, ...patch };
    input.publish(view);
  };

  const check = (): AppUpdateView => {
    if (disposed || !view.supported || input.blocked) return view;

    if (["checking", "downloading", "ready"].includes(view.phase)) return view;

    const headers: UpdateHeaders = { "X-Polaris-macOS-Version": view.macOSVersion };

    if (view.automatic) headers["X-Polaris-Install-ID"] = view.installId;

    change({ phase: "checking", availableVersion: null });

    try {
      input.native.setFeedURL({
        url: `${UPDATE_BASE_URL}/api/update/darwin-arm64/${encodeURIComponent(view.version)}`,
        headers,
      });
      input.native.checkForUpdates();
    } catch {
      finish("failed");
    }

    return view;
  };

  const arm = () => {
    cancelTimer?.();
    cancelTimer = null;

    if (disposed || !view.supported || input.blocked || !view.automatic || view.phase === "ready")
      return;
    cancelTimer = schedule(() => {
      cancelTimer = null;
      check();
      arm();
    }, CHECK_INTERVAL_MS);
  };

  const finish = (
    phase: "current" | "failed" | "ready",
    availableVersion: string | null = null
  ) => {
    if (disposed) return;
    const lastCheckedAt = now();
    input.save({ appUpdateLastCheckedAt: lastCheckedAt });
    change({ phase, availableVersion, lastCheckedAt });
    arm();
  };

  const checking = () => change({ phase: "checking" });
  const available = () => change({ phase: "downloading" });
  const current = () => finish("current");
  const failed = () => finish("failed");

  const downloaded = (
    _event: Electron.Event,
    _notes: string,
    _name: string,
    _date: Date,
    url: string
  ) => finish("ready", versionFromAsset(url));

  input.native.on("checking-for-update", checking);
  input.native.on("update-available", available);
  input.native.on("update-not-available", current);
  input.native.on("error", failed);
  input.native.on("update-downloaded", downloaded);

  return {
    get: () => view,
    check,
    start: () => {
      if (view.automatic) check();
      arm();
    },
    setAutomatic: (automatic: boolean) => {
      input.save({ automaticAppUpdates: automatic });
      change({ automatic });
      // A request already sent cannot be recalled; future manual checks omit the identity.
      arm();

      return view;
    },
    install: () => {
      if (view.phase === "ready") input.native.quitAndInstall();
    },
    dispose: () => {
      disposed = true;
      cancelTimer?.();
      input.native.removeListener("checking-for-update", checking);
      input.native.removeListener("update-available", available);
      input.native.removeListener("update-not-available", current);
      input.native.removeListener("error", failed);
      input.native.removeListener("update-downloaded", downloaded);
    },
  };
};

export type AppUpdates = ReturnType<typeof createAppUpdates>;
