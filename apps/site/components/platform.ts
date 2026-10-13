import type { WindowsArch } from "../app/api/update/_lib/releases.ts";
import { links } from "./links";

/** The visitor's desktop platform, read from the User-Agent and Client hints. */
export type Platform =
  | { readonly os: "mac" }
  | { readonly os: "windows"; readonly arch: WindowsArch | null };

export interface PlatformSignals {
  readonly userAgent: string;
  /** `navigator.userAgentData.platform`, e.g. "Windows" or "macOS". */
  readonly platform?: string | undefined;
  /** High-entropy Client hints: "arm" or "x86", and "64" or "32". */
  readonly architecture?: string | undefined;
  readonly bitness?: string | undefined;
}

/** What the server renders and every non-Windows visitor sees: macOS is the primary platform. */
export const defaultPlatform: Platform = { os: "mac" };

const windowsArch = (signals: PlatformSignals): WindowsArch | null => {
  if (signals.architecture === "arm") return "arm64";

  if (signals.architecture === "x86" && signals.bitness === "64") return "x64";

  return /\b(?:ARM64|aarch64)\b/i.test(signals.userAgent) ? "arm64" : null;
};

/** Windows only when it says so; arch stays null unless a hint or the UA names it. */
export function detectPlatform(signals: PlatformSignals): Platform {
  const windows = signals.platform === "Windows" || /\bWindows NT\b/.test(signals.userAgent);

  return windows ? { os: "windows", arch: windowsArch(signals) } : defaultPlatform;
}

export interface DownloadLink {
  readonly label: string;
  readonly href: string;
}

export interface DownloadOffer {
  readonly os: Platform["os"];
  readonly href: string;
  readonly label: string;
  readonly experimental: boolean;
  /** Replaces the hero note on Windows; null keeps the caller's. */
  readonly note: string | null;
  /** Shown after `othersLabel`, so every platform stays one click away. */
  readonly othersLabel: string;
  readonly others: readonly DownloadLink[];
}

export const windowsNote =
  "Unsigned, so SmartScreen will warn · Agents run on Mac or Linux hosts over SSH";

const otherArch = { x64: "arm64", arm64: "x64" } as const;

/** The primary download for a platform; unknown Windows arch gets x64 with arm64 beside it. */
export function downloadOffer(platform: Platform): DownloadOffer {
  if (platform.os === "mac")
    return {
      os: "mac",
      href: links.download,
      label: "Download for macOS",
      experimental: false,
      note: null,
      othersLabel: "Also on Windows (experimental):",
      others: [
        { label: "x64", href: links.windows.x64 },
        { label: "arm64", href: links.windows.arm64 },
      ],
    };
  const arch = platform.arch ?? "x64";
  const other = otherArch[arch];

  return {
    os: "windows",
    href: links.windows[arch],
    label: "Download for Windows",
    experimental: true,
    note: windowsNote,
    othersLabel: "Also:",
    others: [
      { label: `Windows ${other}`, href: links.windows[other] },
      { label: "macOS", href: links.download },
    ],
  };
}

interface UADataValues {
  readonly architecture?: string;
  readonly bitness?: string;
}

interface NavigatorUAData {
  readonly platform: string;
  getHighEntropyValues(hints: readonly string[]): Promise<UADataValues>;
}

declare global {
  interface Navigator {
    /** Chromium's User-Agent Client Hints; absent in Safari and Firefox. */
    readonly userAgentData?: NavigatorUAData;
  }
}

interface DetectionState {
  current: Platform;
  started: boolean;
  readonly listeners: Set<() => void>;
}

const state: DetectionState = { current: defaultPlatform, started: false, listeners: new Set() };

const publish = (next: Platform) => {
  state.current = next;

  for (const listener of state.listeners) listener();
};

const start = () => {
  if (state.started) return;
  state.started = true;
  const data = navigator.userAgentData;
  const base = { userAgent: navigator.userAgent, platform: data?.platform };
  const first = detectPlatform(base);
  publish(first);

  if (first.os !== "windows" || first.arch !== null || data === undefined) return;
  data
    .getHighEntropyValues(["architecture", "bitness"])
    .then((values) => publish(detectPlatform({ ...base, ...values })))
    .catch(() => undefined);
};

/** A `useSyncExternalStore` source: the first subscriber starts detection once. */
export const platformStore = {
  subscribe: (listener: () => void) => {
    state.listeners.add(listener);
    start();

    return () => {
      state.listeners.delete(listener);
    };
  },
  snapshot: () => state.current,
  serverSnapshot: () => defaultPlatform,
};
