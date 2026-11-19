/** Polaris downloads the Update itself, so there is progress to show (docs/adr/0115). */
import { createHash } from "node:crypto";
import { createReadStream, rmSync } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** A server silent for this long is a dropped connection. */
export const STALL_MS = 60_000;

export interface DownloadInput {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly url: string;
  /** The pending folder; only this download's files are kept in it. */
  readonly dir: string;
  readonly name: string;
  /** The size the feed promised (Windows' RELEASES); macOS's feed names none. */
  readonly expectedBytes: number | null;
  readonly signal: AbortSignal;
  readonly onProgress: (receivedBytes: number, totalBytes: number | null) => void;
  readonly stallMs?: number | undefined;
}

export type DownloadResult =
  | { readonly ok: true; readonly path: string; readonly bytes: number }
  | { readonly ok: false; readonly receivedBytes: number; readonly totalBytes: number | null };

const sizeOf = async (path: string) => {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
};

/**
 * Removes a file or folder. Electron's `fs` reads an `app.asar` as a folder it cannot empty,
 * so an unpacked app is only removable with `process.noAsar` set; synchronous, so nothing else sees it.
 */
export const removeTree = (path: string) => {
  const asar = process.noAsar;

  process.noAsar = true;

  try {
    rmSync(path, { recursive: true, force: true });
  } finally {
    process.noAsar = asar;
  }
};

/** Leftovers of an older Release never accumulate; this download's partial file is its resume point. */
const keepOnly = async (dir: string, keep: string) => {
  await mkdir(dir, { recursive: true });

  for (const entry of await readdir(dir)) if (entry !== keep) removeTree(join(dir, entry));
};

const numberOf = (text: string | null | undefined) => {
  const value = text == null ? Number.NaN : Number(text);

  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

/** Where the body starts and how large the whole file is, or null for an answer that can't be used. */
const layoutOf = (response: Response, offset: number) => {
  if (response.status === 206) {
    const range = /^bytes (\d+)-\d+\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");

    return range !== null && Number(range[1]) === offset
      ? { start: offset, total: numberOf(range[2]) }
      : null;
  }

  return response.status === 200
    ? { start: 0, total: numberOf(response.headers.get("Content-Length")) }
    : null;
};

interface Attempt {
  readonly received: number;
  readonly total: number | null;
  readonly complete: boolean;
  /** The server refused the resume point; the partial file is gone and a fresh request may work. */
  readonly restart: boolean;
}

/** Rejects when `signal` aborts, so a read of a body that ignores the abort still ends. */
const abortion = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    const stop = () => reject(new Error("aborted"));

    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });

const attempt = async (input: DownloadInput, part: string): Promise<Attempt> => {
  const offset = await sizeOf(part);
  const stall = new AbortController();
  const stallMs = input.stallMs ?? STALL_MS;
  const signal = AbortSignal.any([input.signal, stall.signal]);
  const aborted = abortion(signal);
  let timer = setTimeout(() => stall.abort(), stallMs);
  let received = offset;
  let total = input.expectedBytes;

  aborted.catch(() => undefined);

  try {
    const response = await input.fetch(input.url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      cache: "no-store",
      signal,
    });

    const layout = layoutOf(response, offset);
    const promised = layout?.total ?? null;

    if (
      layout === null ||
      response.body === null ||
      (total !== null && promised !== null && promised !== total)
    ) {
      await response.body?.cancel().catch(() => undefined);
      await rm(part, { force: true });

      return { received: 0, total, complete: false, restart: response.status === 416 };
    }

    total = promised ?? total;
    received = layout.start;
    // SAFETY: a fetch body is a byte stream; the DOM and Node stream types disagree on its chunk.
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const file = await open(part, layout.start === 0 ? "w" : "a");

    try {
      input.onProgress(received, total);

      for (;;) {
        const next = await Promise.race([reader.read(), aborted]);

        if (next.done) break;
        clearTimeout(timer);
        timer = setTimeout(() => stall.abort(), stallMs);
        await file.write(next.value);
        received += next.value.byteLength;
        input.onProgress(received, total);
      }
    } finally {
      await file.close();
      void reader.cancel().catch(() => undefined);
    }

    return { received, total, complete: total === null || received === total, restart: false };
  } catch {
    return { received, total, complete: false, restart: false };
  } finally {
    clearTimeout(timer);
  }
};

/** Resumes `<name>.part` with a Range request; the finished file is `<dir>/<name>`. */
export const downloadUpdate = async (input: DownloadInput): Promise<DownloadResult> => {
  const part = join(input.dir, `${input.name}.part`);

  try {
    await keepOnly(input.dir, `${input.name}.part`);
  } catch {
    return { ok: false, receivedBytes: 0, totalBytes: input.expectedBytes };
  }

  let result = await attempt(input, part);

  if (result.restart && !input.signal.aborted) result = await attempt(input, part);

  if (!result.complete || result.received === 0)
    return { ok: false, receivedBytes: result.received, totalBytes: result.total };

  const path = join(input.dir, input.name);
  await rename(part, path);

  return { ok: true, path, bytes: result.received };
};

export const sha1Of = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha1");

    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
