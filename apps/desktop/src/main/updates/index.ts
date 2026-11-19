import type { AutoUpdater, Event } from "electron";
import type { AppUpdateFailure, AppUpdateView } from "../../shared/appUpdates.ts";
import type { LocalFeed } from "./localFeed.ts";
import { updateFeed } from "./platform.ts";
import { macRelease, windowsRelease, type OfferedUpdate } from "./release.ts";
import { clearPending, stageUpdate, type Verify } from "./stage.ts";
import { versionFromAsset } from "./version.ts";

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
  /** Replaces `HANDOVER_TIMEOUT_MS`; tests only. */
  readonly handoverTimeoutMs?: number;
  /** The package's request, which refuses a redirect off https; the app passes `downloadFetch`. */
  readonly download?: (url: string, init: RequestInit) => Promise<Response>;
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

/** One Squirrel operation, in flight from `checkForUpdates` until its terminal event or timeout. */
interface Handover {
  readonly version: string;
  readonly feed: LocalFeed;
  readonly cancelTimeout: () => void;
}

/** A handover Squirrel went quiet on: it keeps Squirrel's one slot until it ends or its claim lapses. */
interface Quiet {
  readonly handover: Handover;
  holds: boolean;
  readonly cancelLapse: () => void;
}

/** Squirrel names what it finished: the zip (macOS) or the feed (Windows) under this feed's root. */
const finished = (handover: Handover, platform: string, url: string | undefined) => {
  // Squirrel.Windows may name nothing; then one operation at a time is the only tie.
  if (url === undefined || url === "") return platform === "win32";

  if (!`${url}/`.startsWith(`${handover.feed.root}/`)) return false;

  return platform === "win32" || versionFromAsset(url) === handover.version;
};

export const createAppUpdates = (input: UpdateInput) => {
  const platform = input.platform ?? "darwin";
  const now = input.now ?? Date.now;
  const schedule = input.schedule ?? scheduleCheck;
  const abort = new AbortController();
  let cancelTimer: (() => void) | null = null;
  const handoverTimeoutMs = input.handoverTimeoutMs ?? HANDOVER_TIMEOUT_MS;
  let handover: Handover | null = null;
  let quiet: Quiet | null = null;
  let wake: (() => void) | null = null;
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

  /** The quiet operation ended, or outlived its claim: Squirrel may be given the next feed. */
  const release = () => {
    if (quiet !== null) quiet.holds = false;
    quiet?.cancelLapse();
    wake?.();
  };

  /** Squirrel went quiet: the Update failed, and its operation holds the slot one more timeout. */
  const abandon = () => {
    const ended = endHandover();

    if (ended === null) return;
    quiet?.cancelLapse();
    quiet = {
      handover: ended,
      holds: true,
      cancelLapse: scheduleCheck(release, handoverTimeoutMs),
    };
    fail({ stage: "verify", version: ended.version, percent: null });
  };

  /** `error` and `update-not-available` name nothing: they end whichever operation holds the slot. */
  const failedHandover = () => {
    const ended = endHandover();

    if (ended === null) release();
    else fail({ stage: "verify", version: ended.version, percent: null });
  };

  const ready = (version: string) => {
    clearPending(input.pendingDir);
    settle({ phase: "ready", readyVersion: version, failure: null });
  };

  /** A quiet Update that Squirrel finished after all is ready, unless a newer try began. */
  const finishedLate = (late: Handover) => {
    release();
    quiet = null;

    if (handover === null && view.phase === "failed" && view.failure?.version === late.version)
      ready(late.version);
  };

  const downloaded = (_event: Event, _notes: string, _name: string, _date: Date, url?: string) => {
    if (handover !== null && finished(handover, platform, url)) {
      const { version } = handover;

      endHandover();
      ready(version);

      return;
    }

    if (quiet !== null && finished(quiet.handover, platform, url)) {
      finishedLate(quiet.handover);

      return;
    }

    // It names neither: nothing proves Squirrel has the Update it was handed.
    const ended = endHandover();

    if (ended !== null) fail({ stage: "verify", version: ended.version, percent: null });
  };

  /** Resolves once no quiet operation holds Squirrel's slot: at most one timeout away. */
  const nativeIdle = () =>
    new Promise<void>((resolve) => {
      if (quiet?.holds !== true) {
        resolve();

        return;
      }

      wake = () => {
        wake = null;
        resolve();
      };
    });

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
      fetch: input.download ?? input.fetch,
      signal: abort.signal,
      onProgress: progress(update.version),
      verify: input.verify,
    });

    // Squirrel runs one operation at a time: a new feed waits for a quiet one to end or lapse.
    if (staged.ok) await nativeIdle();

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
      cancelTimeout: scheduleCheck(abandon, handoverTimeoutMs),
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
      release();
      input.native.removeListener("update-not-available", failedHandover);
      input.native.removeListener("error", failedHandover);
      input.native.removeListener("update-downloaded", downloaded);
    },
  };
};

export type AppUpdates = ReturnType<typeof createAppUpdates>;
