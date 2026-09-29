/**
 * Reads the complete lines appended to a log since `offset`, in chunks, and
 * decodes only the lines that contain one of `markers`: most log bytes (tool
 * output, file contents) are never turned into strings.
 */
import { open } from "node:fs/promises";

const CHUNK_BYTES = 1 << 20;

const NEWLINE = 0x0a;

export interface ScanOptions {
  readonly markers: ReadonlyArray<string>;
  /**
   * When a matching line always has its marker within its first bytes (Codex),
   * a longer line without one there is skipped unread instead of buffered.
   */
  readonly markerWithin?: number;
}

export interface ScanResult {
  /** Where the next pass starts: just after the last complete line. */
  readonly offset: number;
  /** `onLine` asked to stop; `offset` is then not meaningful. */
  readonly stopped: boolean;
}

const decoder = new TextDecoder();

/**
 * Every scan reads into this one buffer: fresh buffers per file stay resident
 * until a late GC. It grows only for a line longer than it, and shrinks back.
 */
let shared = Buffer.allocUnsafe(CHUNK_BYTES);

/** Each complete line in `buffer[0, end)` that contains a marker; false when `onLine` stopped. */
const matchingLines = (
  buffer: Buffer,
  end: number,
  markers: ReadonlyArray<Buffer>,
  onLine: (line: string) => boolean
): boolean => {
  let cursor = 0;

  while (cursor < end) {
    let hit = -1;

    for (const marker of markers) {
      const at = buffer.indexOf(marker, cursor);

      if (at !== -1 && at < end && (hit === -1 || at < hit)) hit = at;
    }

    if (hit === -1) return true;
    const start = buffer.lastIndexOf(NEWLINE, hit) + 1;
    const stop = buffer.indexOf(NEWLINE, hit);

    if (onLine(decoder.decode(buffer.subarray(start, stop)))) return false;
    cursor = stop + 1;
  }

  return true;
};

const hasMarker = (bytes: Buffer, markers: ReadonlyArray<Buffer>) =>
  markers.some((marker) => bytes.includes(marker));

class Scan {
  buffer = shared;
  /** Bytes at the start of `buffer`: the line in progress. */
  carried = 0;
  /** Inside a long line without a marker: drop bytes until its newline. */
  skipping = false;

  constructor(
    readonly needles: ReadonlyArray<Buffer>,
    readonly markerWithin: number | undefined
  ) {}

  /** Makes room to read more; may start skipping the line in progress instead. */
  room() {
    if (this.carried < this.buffer.length) return;
    const head = this.buffer.subarray(0, Math.min(this.carried, this.markerWithin ?? 0));

    if (this.markerWithin !== undefined && !hasMarker(head, this.needles)) {
      this.skipping = true;
      this.carried = 0;

      return;
    }

    const grown = Buffer.allocUnsafe(this.buffer.length * 2);
    this.buffer.copy(grown, 0, 0, this.carried);
    this.buffer = grown;
  }

  /** Drops the skipped line's bytes; returns where the kept data starts. */
  skip(filled: number): number {
    if (!this.skipping) return 0;
    const newline = this.buffer.subarray(0, filled).indexOf(NEWLINE);

    if (newline === -1) return filled;
    this.skipping = false;

    return newline + 1;
  }
}

/**
 * Calls `onLine` for each matching line in `[offset, size)` of `path`; it
 * returns true to stop early. A last line without its newline yet is left for
 * the next pass.
 */
export const scanLines = async (
  path: string,
  offset: number,
  size: number,
  options: ScanOptions,
  onLine: (line: string) => boolean
): Promise<ScanResult> => {
  const scan = new Scan(
    options.markers.map((marker) => Buffer.from(marker)),
    options.markerWithin
  );

  const handle = await open(path, "r");
  let position = offset;
  let consumed = offset;

  try {
    while (position < size) {
      scan.room();
      const want = Math.min(scan.buffer.length - scan.carried, CHUNK_BYTES, size - position);
      const { bytesRead } = await handle.read(scan.buffer, scan.carried, want, position);

      if (bytesRead <= 0) break;
      const bufferStart = position - scan.carried;
      position += bytesRead;
      const filled = scan.carried + bytesRead;
      const from = scan.skip(filled);

      // A skipped line just ended: the next pass starts after it.
      if (from > 0 && !scan.skipping) consumed = bufferStart + from;

      if (from === filled) {
        scan.carried = 0;
        continue;
      }

      const view = scan.buffer.subarray(from, filled);
      const end = view.lastIndexOf(NEWLINE) + 1;

      if (end > 0) {
        if (!matchingLines(view, end, scan.needles, onLine))
          return { offset: consumed, stopped: true };
        consumed = bufferStart + from + end;
      }

      scan.buffer.copy(scan.buffer, 0, from + end, filled);
      scan.carried = filled - from - end;
    }
  } finally {
    await handle.close();
    shared = scan.buffer.length > CHUNK_BYTES ? Buffer.allocUnsafe(CHUNK_BYTES) : scan.buffer;
  }

  return { offset: consumed, stopped: false };
};

/** The first line of a file (Codex's `session_meta`), or null when it has none yet. */
export const firstLine = async (path: string): Promise<string | null> => {
  const handle = await open(path, "r");
  let bytes = Buffer.allocUnsafe(64 * 1024);
  let filled = 0;

  try {
    for (;;) {
      const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, filled);
      const stop = bytes.subarray(filled, filled + bytesRead).indexOf(NEWLINE);

      if (stop !== -1) return decoder.decode(bytes.subarray(0, filled + stop));

      if (bytesRead === 0) return null;
      filled += bytesRead;

      if (filled === bytes.length) {
        const grown = Buffer.allocUnsafe(bytes.length * 4);
        bytes.copy(grown);
        bytes = grown;
      }
    }
  } finally {
    await handle.close();
  }
};
