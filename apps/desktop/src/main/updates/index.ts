import type { AutoUpdater, Event } from "electron";
import type { AppUpdateFailure, AppUpdateView } from "../../shared/appUpdates.ts";
import type { LocalFeed } from "./localFeed.ts";
import { updateFeed } from "./platform.ts";
import { macRelease, windowsRelease, type OfferedUpdate } from "./release.ts";
import { clearPending, stageUpdate, type Staged, type Verify } from "./stage.ts";
import { isNewer, versionFromAsset } from "./version.ts";

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

/** One download, from the feed's answer until its handover or its end; a newer one replaces it. */
interface Staging {
  readonly version: string;
  readonly abort: AbortController;
  done: Promise<void>;
}

/** The address Squirrel names is under this handover's own unguessable feed. */
const names = (handover: Handover, url: string) => `${url}/`.startsWith(`${handover.feed.root}/`);

export const createAppUpdates = (input: UpdateInput) => {
  const platform = input.platform ?? "darwin";
  const windows = platform === "win32";
  const now = input.now ?? Date.now;
  const schedule = input.schedule ?? scheduleCheck;
  const abort = new AbortController();
  let cancelTimer: (() => void) | null = null;
  const handoverTimeoutMs = input.handoverTimeoutMs ?? HANDOVER_TIMEOUT_MS;
  let handover: Handover | null = null;
  let staging: Staging | null = null;
  /** A feed request is in flight. */
  let asking = false;
  /** The newest Release a check has offered, which a newer one may pass over. */
  let offered: string | null = null;
  /** Timed out and never ended, oldest first: each may still send its one terminal event. */
  const stale: Array<Handover> = [];
  /** Set while the newest stale operation still keeps Squirrel's one slot. */
  let hold: (() => void) | null = null;
  const wakes = new Set<() => void>();
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

    // Checks continue while an Update is ready: a newer Release replaces it (ENG-975).
    if (disposed || !view.supported || input.blocked || !view.automatic) return;
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
    change({ download: null, replaces: null, skipped: null, ...patch });
    arm();
  };

  /** A Release Squirrel already has stays ready, and installable, through a newer one's failure. */
  const fail = (failure: AppUpdateFailure, patch: Partial<AppUpdateView> = {}) =>
    settle({ phase: view.readyVersion === null ? "failed" : "ready", failure, ...patch });

  const endHandover = () => {
    const ended = handover;

    handover = null;
    ended?.cancelTimeout();
    ended?.feed.close();

    return ended;
  };

  /** The slot is free: Squirrel may be given the next feed. */
  const release = () => {
    hold?.();
    hold = null;

    for (const wake of wakes) wake();
  };

  /**
   * Squirrel went quiet: the Update failed and its operation keeps the slot. A macOS completion
   * names its feed, so there the slot frees after one more timeout. Squirrel.Windows names
   * nothing, so there only its own terminal event (or a restart) frees it.
   */
  const abandon = () => {
    const ended = endHandover();

    if (ended === null) return;
    stale.push(ended);
    hold?.();
    hold = windows ? () => undefined : scheduleCheck(release, handoverTimeoutMs);
    fail({ stage: windows ? "install" : "verify", version: ended.version, percent: null });
  };

  const ready = (version: string) => {
    clearPending(input.pendingDir);
    settle({ phase: "ready", readyVersion: version, failure: null });
  };

  /** A stale operation ended. Its Update is ready if Squirrel finished it and nothing newer began. */
  const endStale = (ended: Handover, completed: boolean) => {
    if (ended === stale.at(-1)) release();
    stale.splice(stale.indexOf(ended), 1);

    if (handover !== null || staging !== null || view.failure?.version !== ended.version) return;

    if (completed) ready(ended.version);
    // The slot is free again, so the row offers "Try again" instead of a restart.
    else if (view.failure.stage === "install")
      fail({ stage: "verify", version: ended.version, percent: null });
  };

  const end = (ended: Handover, completed: boolean) => {
    if (ended !== handover) {
      endStale(ended, completed);

      return;
    }

    endHandover();

    if (completed) ready(ended.version);
    else fail({ stage: "verify", version: ended.version, percent: null });
  };

  /** Squirrel ends operations in the order it was given them: an unnamed event is the oldest's. */
  const oldest = () => stale[0] ?? handover;

  /** `error` and `update-not-available` name nothing. */
  const failedHandover = () => {
    const ended = oldest();

    if (ended !== null) end(ended, false);
  };

  const downloaded = (_event: Event, _notes: string, _name: string, _date: Date, url?: string) => {
    const address = url ?? "";
    const named = [...stale, handover].find((one) => one != null && names(one, address));

    if (address !== "" && named != null) {
      end(named, windows || versionFromAsset(address) === named.version);

      return;
    }

    const ended = oldest();

    // Only Squirrel.Windows may finish without naming what; anything else proves nothing.
    if (ended !== null) end(ended, windows && address === "");
  };

  /** Resolves once no stale operation keeps Squirrel's slot, or the download is replaced. */
  const nativeIdle = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (hold === null || signal.aborted) {
        resolve();

        return;
      }

      const wake = () => {
        wakes.delete(wake);
        signal.removeEventListener("abort", wake);
        resolve();
      };

      wakes.add(wake);
      signal.addEventListener("abort", wake);
    });

  /** Publishes the first and last byte counts, and one in between every interval. */
  const progress = (version: string, mine: Staging) => {
    const interval = input.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
    let last = Number.NEGATIVE_INFINITY;

    return (receivedBytes: number, totalBytes: number | null) => {
      const at = Date.now();

      if (staging !== mine) return;

      if (receivedBytes !== totalBytes && at - last < interval) return;
      last = at;
      change({ download: { version, receivedBytes, totalBytes } });
    };
  };

  const download = async (update: OfferedUpdate, mine: Staging, signal: AbortSignal) => {
    const staged = await stageUpdate({
      platform,
      update,
      dir: input.pendingDir,
      bundle: input.bundle,
      fetch: input.download ?? input.fetch,
      signal,
      onProgress: progress(update.version, mine),
      verify: input.verify,
    }).catch((): Staged => ({ ok: false, stage: "download", percent: null }));

    // Squirrel runs one operation at a time: a new feed waits for a quiet one to end or lapse.
    if (staged.ok) await nativeIdle(signal);

    if (disposed || staging !== mine) {
      if (staged.ok) staged.feed.close();

      return;
    }

    staging = null;

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

  /** Downloads the offered Release; one still downloading waits to stop first, then its files go. */
  const stage = (update: OfferedUpdate) => {
    const previous = staging;
    const replaces = previous?.version ?? view.readyVersion;

    const skipped =
      offered !== null && offered !== replaces && isNewer(offered, view.version) ? offered : null;

    const mine: Staging = {
      version: update.version,
      abort: new AbortController(),
      done: Promise.resolve(),
    };

    const signal = AbortSignal.any([abort.signal, mine.abort.signal]);

    previous?.abort.abort();
    staging = mine;
    offered = update.version;
    change({
      phase: "downloading",
      availableVersion: update.version,
      download: { version: update.version, receivedBytes: 0, totalBytes: update.bytes },
      replaces,
      skipped,
      failure: null,
    });
    mine.done = (previous?.done ?? Promise.resolve()).then(() =>
      signal.aborted ? undefined : download(update, mine, signal)
    );

    return mine.done;
  };

  /** The feed's answer. Only a Release newer than the one downloading or ready is downloaded. */
  const answered = (update: OfferedUpdate | "current" | null) => {
    const lastCheckedAt = checked();
    const newest = staging?.version ?? handover?.version ?? view.readyVersion;

    // Squirrel takes one Update at a time; a newer one waits for the next check.
    if (
      handover === null &&
      update !== null &&
      update !== "current" &&
      isNewer(update.version, newest ?? view.version)
    ) {
      change({ lastCheckedAt });

      return stage(update);
    }

    // A download or a ready Update keeps its row whatever this check found.
    if (newest !== null) change({ lastCheckedAt });
    else if (update === null)
      fail(
        { stage: "check", version: null, percent: null },
        { availableVersion: null, lastCheckedAt }
      );
    else settle({ phase: "current", availableVersion: null, failure: null, lastCheckedAt });

    return Promise.resolve();
  };

  /** The site's feed: an Update, `current` (204), or null when it couldn't be read. */
  const ask = async (headers: UpdateHeaders): Promise<OfferedUpdate | "current" | null> => {
    const feed = updateFeed(UPDATE_BASE_URL, platform, input.arch, view.version);

    try {
      const response = await input.fetch(platform === "win32" ? `${feed}/RELEASES` : feed, {
        headers,
        cache: "no-store",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(FEED_TIMEOUT_MS)]),
      });

      if (response.status === 204) return "current";
      const parse = platform === "win32" ? windowsRelease : macRelease;

      return response.ok ? parse(await response.text()) : null;
    } catch {
      return null;
    }
  };

  const check = (): AppUpdateView => {
    if (disposed || !view.supported || input.blocked) return view;

    // One feed request at a time, and none while Squirrel reads an Update.
    if (asking || handover !== null) return view;

    // Windows: a new Squirrel operation can't be told from the one that went quiet.
    if (windows && hold !== null) return view;

    // Squirrel sends no custom headers; this request carries the consent-controlled telemetry.
    const headers: UpdateHeaders =
      platform === "win32"
        ? { "X-Polaris-Windows-Version": view.osVersion }
        : { "X-Polaris-macOS-Version": view.osVersion };

    if (view.automatic) headers["X-Polaris-Install-ID"] = view.installId;

    // A download in progress or a ready Update keeps its row while the feed is asked.
    if (staging === null && view.readyVersion === null)
      change({ phase: "checking", availableVersion: null, failure: null });
    asking = true;
    void ask(headers).then((update) => {
      asking = false;

      return disposed ? undefined : answered(update);
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
