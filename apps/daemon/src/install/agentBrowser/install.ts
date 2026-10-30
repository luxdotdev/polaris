/**
 * Installs the pinned agent-browser into `<root>/<version>/` with the managed model server's
 * verified download (size-bounded, SHA-256 checked, atomic rename), then drops older versions.
 */
import { chmod, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PinnedFile } from "../../prediction/managed/catalog.ts";
import { downloadFile, type Fetcher } from "../../prediction/managed/download.ts";
import { AGENT_BROWSER_ASSETS, AGENT_BROWSER_VERSION } from "./pin.ts";

export interface InstallOptions {
  /** Holds one directory per installed version. */
  readonly root: string;
  /** `runtimePlatform()`: `<os>-<arch>`, plus `-musl` on a musl Linux. */
  readonly platform: string;
  readonly version?: string;
  readonly assets?: Readonly<Record<string, PinnedFile>>;
  readonly fetch?: Fetcher;
  readonly signal?: AbortSignal;
}

export interface InstalledAgentBrowser {
  readonly binary: string;
  /** An empty config, so the user's `~/.agent-browser/config.json` can't change the attach. */
  readonly config: string;
}

/** The platform has no agent-browser build, or none was pinned. */
export class NoAgentBrowserBuild extends Error {}

export const installAgentBrowser = async (
  options: InstallOptions
): Promise<InstalledAgentBrowser> => {
  const version = options.version ?? AGENT_BROWSER_VERSION;
  const assets: Readonly<Record<string, PinnedFile>> = options.assets ?? AGENT_BROWSER_ASSETS;
  const file = Object.hasOwn(assets, options.platform) ? assets[options.platform] : undefined;

  if (file === undefined)
    throw new NoAgentBrowserBuild(`no agent-browser build for ${options.platform}`);
  const dir = join(options.root, version);
  await downloadFile({
    file,
    dir,
    fetch: options.fetch ?? fetch,
    signal: options.signal ?? new AbortController().signal,
    onProgress: () => {},
  });
  const binary = join(dir, file.name);
  await chmod(binary, 0o755);
  const config = join(dir, "config.json");
  await writeFile(config, "{}\n", { mode: 0o600 });
  await pruneOlder(options.root, version);

  return { binary, config };
};

/** An older binary may still serve a running session; Unix keeps it open, Windows refuses. */
const pruneOlder = async (root: string, keep: string) => {
  const entries = await readdir(root);

  await Promise.all(
    entries
      .filter((name) => name !== keep)
      .map((name) => rm(join(root, name), { recursive: true, force: true }).catch(() => {}))
  );
};
