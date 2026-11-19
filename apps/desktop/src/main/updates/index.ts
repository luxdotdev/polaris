import type { AutoUpdater } from "electron";
import type { AppUpdateFailure, AppUpdateView } from "../../shared/appUpdates.ts";
import type { LocalFeed } from "./localFeed.ts";
import { updateFeed } from "./platform.ts";
import { macRelease, windowsRelease, type OfferedUpdate } from "./release.ts";
import { clearPending, stageUpdate, type Verify } from "./stage.ts";

export { versionFromAsset, versionFromNuget } from "./version.ts";

export const UPDATE_BASE_URL = "https://polaris.lux.dev";

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The feed looks a Release up on GitHub before it answers. */
const FEED_TIMEOUT_MS = 15_000;

/** Squirrel reads the Update from loopback and unpacks it; longer than this is a failure. */
const HANDOVER_TIMEOUT_MS = 5 * 60_000;

/** Progress reaches About, the native menu and the K menu at most this often. */
const PROGRESS_INTERVAL_MS = 500;

type UpdateHeaders = {
  "X-Polaris-macOS-Version"?: string;
  "X-Polaris-Windows-Version"?: string;
  "X-Polaris-Install-ID"?: string;
};

export interface UpdateInput {
  readonly native: Pick<
    AutoUpdater,
    "on" | "removeListener" | "setFeedURL" | "checkForUpdates" | "quitAndInstall"
  >;
  readonly version: string;
  readonly installId: string;
  readonly osVersion: string;
  readonly platform?: string;
  readonly firstRun?: boolean;
  /** The feed check and the download; the app passes `internetFetch`. */
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly arch: string;
  readonly supported: boolean;
  readonly blocked: boolean;
  readonly automatic: boolean;
  readonly lastCheckedAt: number | null;
  /** Where a download waits until Squirrel has it (`<userData>/pending-update`). */
  readonly pendingDir: string;
  /** The running app, whose signer a macOS Update must share. */
  readonly bundle: string;
  /** The platform's check of a finished download; tests replace it. */
  readonly verify?: Verify;
  readonly progressIntervalMs?: number;
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

/** An Update Squirrel is reading from the local feed. */
interface Handover {
  readonly version: string;
  readonly feed: LocalFeed;
  readonly cancelTimeout: () => void;
}

export const createAppUpdates = (input: UpdateInput) => {
  const platform = input.platform ?? "darwin";
  const now = input.now ?? Date.now;
  const schedule = input.schedule ?? scheduleCheck;
  const abort = new AbortController();
  let cancelTimer: (() => void) | null = null;
  let handover: Handover | null = null;
  let disposed = false;

  let view: AppUpdateView = {
    phase: input.supported && input.blocked ? "blocked" : "idle",
    version: input.version,
    availableVersion: null,
    readyVersion: null,
    download: null,
    failure: null,
    automatic: input.automatic,
    lastCheckedAt: input.lastCheckedAt,
    installId: input.installId,
    osVersion: input.osVersion,
    platform,
    arch: input.arch,
    supported: input.supported,
  };

  const change = (patch: Partial<AppUpdateView>) => {
    if (disposed) return;
    view = { ...view, ...patch };
    input.publish(view);
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

  /** The feed answered (or didn't): the moment "last checked" names. */
  const checked = () => {
    const lastCheckedAt = now();
    input.save({ appUpdateLastCheckedAt: lastCheckedAt });

    return lastCheckedAt;
  };

  const settle = (patch: Partial<AppUpdateView>) => {
    change({ download: null, ...patch });
    arm();
  };

  const fail = (failure: AppUpdateFailure, patch: Partial<AppUpdateView> = {}) =>
    settle({ phase: "failed", failure, ...patch });

  const failedCheck = () =>
    fail(
      { stage: "check", version: null, percent: null },
      { availableVersion: view.readyVersion, lastCheckedAt: checked() }
    );

  const endHandover = () => {
    const ended = handover;

    handover = null;
    ended?.cancelTimeout();
    ended?.feed.close();

    return ended;
  };

  const failedHandover = () => {
    const ended = endHandover();

    if (ended !== null) fail({ stage: "verify", version: ended.version, percent: null });
  };

  const downloaded = () => {
    const ended = endHandover();

    if (ended === null) return;
    clearPending(input.pendingDir);
    settle({ phase: "ready", readyVersion: ended.version, failure: null });
  };

  /** Publishes the first and last byte counts, and one in between every interval. */
  const progress = (version: string) => {
    const interval = input.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
    let last = Number.NEGATIVE_INFINITY;

    return (receivedBytes: number, totalBytes: number | null) => {
      const at = Date.now();

      if (receivedBytes !== totalBytes && at - last < interval) return;
      last = at;
      change({ download: { version, receivedBytes, totalBytes } });
    };
  };

  const stage = async (update: OfferedUpdate) => {
    change({
      phase: "downloading",
      availableVersion: update.version,
      download: { version: update.version, receivedBytes: 0, totalBytes: update.bytes },
      lastCheckedAt: checked(),
    });

    const staged = await stageUpdate({
      platform,
      update,
      dir: input.pendingDir,
      bundle: input.bundle,
      fetch: input.fetch,
      signal: abort.signal,
      onProgress: progress(update.version),
      verify: input.verify,
    });

    if (disposed) {
      if (staged.ok) staged.feed.close();

      return;
    }

    if (!staged.ok) {
      fail({ stage: staged.stage, version: update.version, percent: staged.percent });

      return;
    }

    handover = {
      version: update.version,
      feed: staged.feed,
      cancelTimeout: scheduleCheck(failedHandover, HANDOVER_TIMEOUT_MS),
    };

    try {
      input.native.setFeedURL({ url: staged.feed.url });
      input.native.checkForUpdates();
    } catch {
      failedHandover();
    }
  };

  const ask = async (headers: UpdateHeaders) => {
    const feed = updateFeed(UPDATE_BASE_URL, platform, input.arch, view.version);

    const response = await input.fetch(platform === "win32" ? `${feed}/RELEASES` : feed, {
      headers,
      cache: "no-store",
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(FEED_TIMEOUT_MS)]),
    });

    if (disposed) return;

    if (response.status === 204) {
      settle({
        phase: "current",
        availableVersion: view.readyVersion,
        failure: null,
        lastCheckedAt: checked(),
      });

      return;
    }

    const parse = platform === "win32" ? windowsRelease : macRelease;
    const update = response.ok ? parse(await response.text()) : null;

    if (disposed) return;

    if (update === null) failedCheck();
    else await stage(update);
  };

  const check = (): AppUpdateView => {
    if (disposed || !view.supported || input.blocked) return view;

    if (["checking", "downloading", "ready"].includes(view.phase)) return view;

    // Squirrel sends no custom headers; this request carries the consent-controlled telemetry.
    const headers: UpdateHeaders =
      platform === "win32"
        ? { "X-Polaris-Windows-Version": view.osVersion }
        : { "X-Polaris-macOS-Version": view.osVersion };

    if (view.automatic) headers["X-Polaris-Install-ID"] = view.installId;

    change({ phase: "checking", availableVersion: view.readyVersion, failure: null });
    void ask(headers).catch(() => {
      if (view.phase === "checking") failedCheck();
      else if (view.phase === "downloading")
        fail({ stage: "download", version: view.download?.version ?? null, percent: null });
    });

    return view;
  };

  input.native.on("update-not-available", failedHandover);
  input.native.on("error", failedHandover);
  input.native.on("update-downloaded", downloaded);

  return {
    get: () => view,
    check,
    start: () => {
      if (view.automatic && !input.firstRun) check();
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
      if (view.readyVersion !== null) input.native.quitAndInstall();
    },
    dispose: () => {
      disposed = true;
      cancelTimer?.();
      abort.abort();
      endHandover();
      input.native.removeListener("update-not-available", failedHandover);
      input.native.removeListener("error", failedHandover);
      input.native.removeListener("update-downloaded", downloaded);
    },
  };
};

export type AppUpdates = ReturnType<typeof createAppUpdates>;
