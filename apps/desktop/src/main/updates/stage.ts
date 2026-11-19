/** Download, verify, then serve one Update to Squirrel from loopback (docs/adr/0116). */
import { rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { downloadUpdate, removeTree } from "./download.ts";
import { openPackage, serveLocalFeed, stillNames, type LocalFeed } from "./localFeed.ts";
import type { OfferedUpdate } from "./release.ts";
import { verifyMacUpdate, verifyWindowsUpdate } from "./verify.ts";

/** `file` is the download as opened; a check that must read `path` is held to the same file after. */
export type Verify = (
  path: string,
  update: OfferedUpdate,
  bytes: number,
  file: FileHandle
) => Promise<boolean>;

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
  (path, update, bytes, file) =>
    input.platform === "win32"
      ? verifyWindowsUpdate(path, update, bytes, file)
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
  // Opened once: this descriptor is what gets verified, compared and served.
  const file = await openPackage(downloaded.path);
  const refused: Staged = { ok: false, stage: "verify", percent: null };

  if (file === null) return refused;

  try {
    const verified =
      (await verify(downloaded.path, input.update, downloaded.bytes, file)) &&
      (await stillNames(downloaded.path, file));

    if (!verified) {
      // A file that failed its check is never a resume point.
      await rm(downloaded.path, { force: true }).catch(() => undefined);
      await file.close();

      return refused;
    }

    const feed = await serveLocalFeed({
      platform: input.platform,
      file,
      bytes: downloaded.bytes,
      sha1: input.update.sha1,
      update: input.update,
    });

    return { ok: true, feed };
  } catch {
    await file.close().catch(() => undefined);

    return refused;
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
