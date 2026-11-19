/** Download, verify, then serve one Update to Squirrel from loopback (docs/adr/0115). */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { downloadUpdate, removeTree } from "./download.ts";
import { serveLocalFeed, type LocalFeed } from "./localFeed.ts";
import type { OfferedUpdate } from "./release.ts";
import { verifyMacUpdate, verifyWindowsUpdate } from "./verify.ts";

export type Verify = (path: string, update: OfferedUpdate, bytes: number) => Promise<boolean>;

export interface StageInput {
  readonly platform: string;
  readonly update: OfferedUpdate;
  /** The pending folder under userData. */
  readonly dir: string;
  /** The running app (Polaris.app), whose signer a macOS Update must share. */
  readonly bundle: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly signal: AbortSignal;
  readonly onProgress: (receivedBytes: number, totalBytes: number | null) => void;
  readonly verify?: Verify | undefined;
  readonly stallMs?: number | undefined;
}

export type Staged =
  | { readonly ok: true; readonly feed: LocalFeed }
  | {
      readonly ok: false;
      readonly stage: "download" | "verify";
      readonly percent: number | null;
    };

const platformVerify =
  (input: StageInput): Verify =>
  (path, update, bytes) =>
    input.platform === "win32"
      ? verifyWindowsUpdate(path, update, bytes)
      : verifyMacUpdate({ zip: path, scratch: join(input.dir, "unpacked"), bundle: input.bundle });

export const stageUpdate = async (input: StageInput): Promise<Staged> => {
  const downloaded = await downloadUpdate({
    fetch: input.fetch,
    url: input.update.url,
    dir: input.dir,
    name: input.update.file,
    expectedBytes: input.update.bytes,
    signal: input.signal,
    onProgress: input.onProgress,
    stallMs: input.stallMs,
  });

  if (!downloaded.ok)
    return {
      ok: false,
      stage: "download",
      percent:
        downloaded.totalBytes === null || downloaded.totalBytes <= 0
          ? null
          : Math.floor((downloaded.receivedBytes / downloaded.totalBytes) * 100),
    };

  const verify = input.verify ?? platformVerify(input);

  if (!(await verify(downloaded.path, input.update, downloaded.bytes))) {
    // A file that failed its check is never a resume point.
    await rm(downloaded.path, { force: true }).catch(() => undefined);

    return { ok: false, stage: "verify", percent: null };
  }

  try {
    const feed = await serveLocalFeed({
      platform: input.platform,
      path: downloaded.path,
      bytes: downloaded.bytes,
      sha1: input.update.sha1,
      update: input.update,
    });

    return { ok: true, feed };
  } catch {
    return { ok: false, stage: "verify", percent: null };
  }
};

/** Squirrel keeps its own copy once it has the Update; ours goes. */
export const clearPending = (dir: string) => {
  try {
    removeTree(dir);
  } catch {
    // The next download clears the folder again before it starts.
  }
};
