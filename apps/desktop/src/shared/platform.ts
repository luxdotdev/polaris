/**
 * The Client's own operating system, the one seam every platform-dependent label, key and
 * chrome choice reads. The main process knows it from `process.platform` and passes it to the
 * preload, which exposes it to the sandboxed renderer as `window.polaris.platform`.
 */

/** How main tells the preload which platform to report (`webPreferences.additionalArguments`). */
export const PLATFORM_ARG = "--polaris-platform=";

/** The platform main passed, else this process's own. */
export const platformFromArgv = (argv: ReadonlyArray<string>, fallback: string): string =>
  argv.find((arg) => arg.startsWith(PLATFORM_ARG))?.slice(PLATFORM_ARG.length) ?? fallback;

/** Windows, macOS, or anything else (Linux and the BSDs share Linux's conventions). */
export type ClientPlatform = "darwin" | "win32" | "linux";

/** Folds a Node `process.platform` value into the three the app distinguishes. */
export const toClientPlatform = (platform: string): ClientPlatform =>
  platform === "darwin" || platform === "win32" ? platform : "linux";

// SAFETY: structural view of globals that may be absent: `process` is undefined in the
// sandboxed renderer and `polaris` exists only there, so both are read as optional.
const globals = globalThis as {
  readonly polaris?: { readonly platform?: string };
  readonly process?: { readonly platform?: string };
};

let override: ClientPlatform | null = null;

/** Which OS this Client runs on; a test's override wins. */
export const clientPlatform = (): ClientPlatform => {
  if (override !== null) return override;

  const platform = globals.polaris?.platform ?? globals.process?.platform;

  return platform === undefined ? "linux" : toClientPlatform(platform);
};

/** Tests pretend to be another OS; `null` restores the real one. */
export const setClientPlatform = (platform: ClientPlatform | null) => {
  override = platform;
};

export const isMac = () => clientPlatform() === "darwin";

export const isWindows = () => clientPlatform() === "win32";
