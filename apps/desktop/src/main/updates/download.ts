/** Polaris downloads the Update itself, so there is progress to show (docs/adr/0116). */
import { createHash } from "node:crypto";
import { constants, createReadStream, rmSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";

/** A server silent for this long is a dropped connection. */
export const STALL_MS = 60_000;

/** No Update is larger than this: a size nobody promised, or a promise past it, stops here. */
export const MAX_UPDATE_BYTES = 1024 ** 3;

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
  /** Replaces `MAX_UPDATE_BYTES`; tests only. */
  readonly maxBytes?: number | undefined;
}

export type DownloadResult =
  | { readonly ok: true; readonly path: string; readonly bytes: number }
  | { readonly ok: false; readonly receivedBytes: number; readonly totalBytes: number | null };

// Windows has no O_NOFOLLOW; there the pending folder's own check stands alone.
const NOFOLLOW = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;

/** The partial file's size; anything that is not a plain file (a symlink) is removed, not followed. */
const partSize = async (part: string) => {
  try {
    const info = await lstat(part);

    if (info.isFile()) return info.size;
    await rm(part, { force: true, recursive: true });
  } catch {
    // No partial file yet.
  }

  return 0;
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

/**
 * The pending folder is ours alone (0700) and a real folder, never a symlink to one. Leftovers of
 * an older Release never accumulate; this download's partial file is its resume point.
 */
const prepare = async (dir: string, keep: ReadonlyArray<string>) => {
  await mkdir(dir, { recursive: true, mode: 0o700 });

  if (!(await lstat(dir)).isDirectory()) throw new Error("the pending folder is not a folder");
  await chmod(dir, 0o700);

  for (const entry of await readdir(dir)) if (!keep.includes(entry)) removeTree(join(dir, entry));
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

/** What the server called this file: a strong ETag, else its Last-Modified date. */
const validatorOf = (response: Response) => {
  const etag = response.headers.get("ETag");

  return etag !== null && !etag.startsWith("W/") ? etag : response.headers.get("Last-Modified");
};

/** Kept beside the partial file, so a resume can ask for the rest of that same file only. */
const remember = async (tag: string, response: Response) => {
  const validator = validatorOf(response);

  if (validator === null) await rm(tag, { force: true });
  else
    await writeFile(tag, validator, {
      mode: 0o600,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW,
    });
};

const discard = async (part: string) => {
  await rm(part, { force: true });
  await rm(`${part}.validator`, { force: true });
};

/** Where to resume: only a partial file whose remote file can be named again is continued. */
const resumePoint = async (part: string) => {
  const offset = await partSize(part);

  const validator =
    offset > 0 ? await readFile(`${part}.validator`, "utf8").catch(() => null) : null;

  if (offset > 0 && validator !== null && validator !== "")
    return { offset, headers: { Range: `bytes=${offset}-`, "If-Range": validator } };
  await discard(part);

  return { offset: 0, headers: {} };
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

type Chunk = { readonly done: true } | { readonly done: false; readonly value: Uint8Array };

interface Body {
  next: () => Promise<Chunk>;
  /** The most the file may hold: its size when known, else the cap. */
  limit: number;
  /** Bytes on disk so far; kept current so a failure can say how far it got. */
  received: number;
  readonly onProgress: (received: number) => void;
}

/** Writes the body to `file`. False when it runs past the limit: that chunk is never written. */
const receive = async (body: Body, file: FileHandle) => {
  body.onProgress(body.received);

  for (;;) {
    const next = await body.next();

    if (next.done) return true;

    if (body.received + next.value.byteLength > body.limit) return false;
    await file.write(next.value);
    body.received += next.value.byteLength;
    body.onProgress(body.received);
  }
};

const attempt = async (input: DownloadInput, part: string): Promise<Attempt> => {
  const from = await resumePoint(part);
  const stall = new AbortController();
  const stallMs = input.stallMs ?? STALL_MS;
  const cap = input.maxBytes ?? MAX_UPDATE_BYTES;
  const signal = AbortSignal.any([input.signal, stall.signal]);
  const aborted = abortion(signal);
  let timer = setTimeout(() => stall.abort(), stallMs);
  let total = input.expectedBytes;

  const body: Body = {
    next: () => Promise.reject(new Error("no body")),
    limit: cap,
    received: from.offset,
    onProgress: (received) => input.onProgress(received, total),
  };

  aborted.catch(() => undefined);

  try {
    const response = await input.fetch(input.url, {
      headers: from.headers,
      cache: "no-store",
      signal,
    });

    const layout = layoutOf(response, from.offset);
    const promised = layout?.total ?? null;
    const size = promised ?? total;

    if (
      layout === null ||
      response.body === null ||
      (total !== null && promised !== null && promised !== total) ||
      (size !== null && size > cap)
    ) {
      await response.body?.cancel().catch(() => undefined);
      await discard(part);

      return { received: 0, total, complete: false, restart: response.status === 416 };
    }

    total = size;
    body.received = layout.start;

    if (layout.start === 0) await remember(`${part}.validator`, response);
    // SAFETY: a fetch body is a byte stream; the DOM and Node stream types disagree on its chunk.
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const flags = constants.O_WRONLY | constants.O_CREAT | NOFOLLOW;

    const file = await open(
      part,
      flags | (layout.start === 0 ? constants.O_TRUNC : constants.O_APPEND),
      0o600
    );

    let fits = false;

    body.limit = total ?? cap;
    body.next = async () => {
      const next = await Promise.race([reader.read(), aborted]);

      clearTimeout(timer);
      timer = setTimeout(() => stall.abort(), stallMs);

      return next.done ? { done: true } : { done: false, value: next.value };
    };

    try {
      fits = await receive(body, file);
    } finally {
      await file.close();
      void reader.cancel().catch(() => undefined);
    }

    if (fits)
      return {
        received: body.received,
        total,
        complete: total === null || body.received === total,
        restart: false,
      };
    // More than the file's size arrived: none of it is a resume point.
    await discard(part);

    return { received: 0, total, complete: false, restart: false };
  } catch {
    return { received: body.received, total, complete: false, restart: false };
  } finally {
    clearTimeout(timer);
  }
};

/** Resumes `<name>.part` with a Range request; the finished file is `<dir>/<name>`. */
export const downloadUpdate = async (input: DownloadInput): Promise<DownloadResult> => {
  const part = join(input.dir, `${input.name}.part`);

  try {
    await prepare(input.dir, [`${input.name}.part`, `${input.name}.part.validator`]);
  } catch {
    return { ok: false, receivedBytes: 0, totalBytes: input.expectedBytes };
  }

  let result = await attempt(input, part);

  if (result.restart && !input.signal.aborted) result = await attempt(input, part);

  if (!result.complete || result.received === 0)
    return { ok: false, receivedBytes: result.received, totalBytes: result.total };

  const path = join(input.dir, input.name);
  await rename(part, path);
  await rm(`${part}.validator`, { force: true });

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
