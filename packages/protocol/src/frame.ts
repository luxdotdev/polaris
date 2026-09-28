/**
 * Wire framing for byte-stream transports (SSH stdio, local Unix sockets).
 *
 *   frame      = length:u32be kind:u8 body          (length counts kind + body)
 *   kind 0     = JSON message, UTF-8
 *   kind 1     = blob chunk: idLength:u8 id:utf8 flags:u8 bytes
 *                flags bit 0 = final chunk of this blob
 *                flags bit 1 = aborted: the sender failed; drop what arrived
 *
 * Large payloads (file reads, diffs, attachments) travel as blob chunks
 * referenced by BlobId from the JSON messages, so they never block a stream.
 */

export const FrameKind = { Json: 0, Blob: 1 } as const;

export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const BLOB_CHUNK_BYTES = 256 * 1024;

export type Frame =
  | { readonly kind: "json"; readonly text: string }
  | {
      readonly kind: "blob";
      readonly blobId: string;
      readonly final: boolean;
      /** The sender gave up on this blob (its source failed); discard it. */
      readonly aborted: boolean;
      readonly bytes: Uint8Array;
    };

export class FrameError extends Error {
  override readonly name = "FrameError";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const header = (bodyLength: number, kind: number): Uint8Array => {
  const length = bodyLength + 1;
  if (length > MAX_FRAME_BYTES) throw new FrameError(`frame of ${length} bytes exceeds limit`);
  const out = new Uint8Array(5);
  new DataView(out.buffer).setUint32(0, length);
  out[4] = kind;
  return out;
};

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  let size = 0;
  for (const p of parts) size += p.byteLength;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
};

export const encodeJsonFrame = (text: string): Uint8Array => {
  const body = encoder.encode(text);
  return concat([header(body.byteLength, FrameKind.Json), body]);
};

export const encodeBlobFrame = (
  blobId: string,
  bytes: Uint8Array,
  final: boolean,
  aborted = false
): Uint8Array => {
  const id = encoder.encode(blobId);
  if (id.byteLength > 255) throw new FrameError("blob id longer than 255 bytes");
  const meta = new Uint8Array(id.byteLength + 2);
  meta[0] = id.byteLength;
  meta.set(id, 1);
  meta[id.byteLength + 1] = (final ? 1 : 0) | (aborted ? 2 : 0);
  return concat([header(meta.byteLength + bytes.byteLength, FrameKind.Blob), meta, bytes]);
};

/** Splits `bytes` into blob frames of at most BLOB_CHUNK_BYTES. Always emits a final frame. */
export function* encodeBlob(blobId: string, bytes: Uint8Array): Generator<Uint8Array> {
  if (bytes.byteLength === 0) {
    yield encodeBlobFrame(blobId, bytes, true);
    return;
  }
  for (let offset = 0; offset < bytes.byteLength; offset += BLOB_CHUNK_BYTES) {
    const end = Math.min(offset + BLOB_CHUNK_BYTES, bytes.byteLength);
    yield encodeBlobFrame(blobId, bytes.subarray(offset, end), end === bytes.byteLength);
  }
}

/**
 * Incremental decoder: feed arbitrary byte chunks, get whole frames back.
 *
 * Incoming chunks are queued, not merged: a frame that fits inside one chunk
 * is a view into it (no copy), and a frame split across chunks is copied once,
 * into a buffer of exactly its size. (Merging on every push copied a 256 KiB
 * blob chunk several times over while it arrived in socket-sized pieces.)
 */
export class FrameDecoder {
  private chunks: Array<Uint8Array> = [];
  private size = 0;

  push(chunk: Uint8Array): Array<Frame> {
    if (chunk.byteLength > 0) {
      this.chunks.push(chunk);
      this.size += chunk.byteLength;
    }
    const frames: Array<Frame> = [];
    while (this.size >= 4) {
      const length = this.peekLength();
      if (length < 1 || length > MAX_FRAME_BYTES)
        throw new FrameError(`bad frame length ${length}`);
      if (this.size - 4 < length) break;
      const frame = this.take(4 + length);
      frames.push(decodeBody(frame[4], frame.subarray(5)));
    }
    return frames;
  }

  get pendingBytes(): number {
    return this.size;
  }

  private peekLength(): number {
    const first = this.chunks[0]!;
    if (first.byteLength >= 4) {
      return new DataView(first.buffer, first.byteOffset, 4).getUint32(0);
    }
    const head = new Uint8Array(4);
    let at = 0;
    for (const chunk of this.chunks) {
      const n = Math.min(4 - at, chunk.byteLength);
      head.set(chunk.subarray(0, n), at);
      at += n;
      if (at === 4) break;
    }
    return new DataView(head.buffer).getUint32(0);
  }

  /** Removes the next `n` bytes (n <= size): a view when they sit in one chunk, else a copy. */
  private take(n: number): Uint8Array {
    this.size -= n;
    const first = this.chunks[0]!;
    if (first.byteLength >= n) {
      if (first.byteLength === n) this.chunks.shift();
      else this.chunks[0] = first.subarray(n);
      return first.subarray(0, n);
    }
    const out = new Uint8Array(n);
    let at = 0;
    while (at < n) {
      const chunk = this.chunks[0]!;
      const need = n - at;
      if (chunk.byteLength <= need) {
        out.set(chunk, at);
        at += chunk.byteLength;
        this.chunks.shift();
      } else {
        out.set(chunk.subarray(0, need), at);
        this.chunks[0] = chunk.subarray(need);
        at = n;
      }
    }
    return out;
  }
}

const decodeBody = (kind: number | undefined, body: Uint8Array): Frame => {
  switch (kind) {
    case FrameKind.Json:
      return { kind: "json", text: decoder.decode(body) };
    case FrameKind.Blob: {
      const idLength = body[0] ?? 0;
      if (body.byteLength < idLength + 2) throw new FrameError("truncated blob frame");
      return {
        kind: "blob",
        blobId: decoder.decode(body.subarray(1, 1 + idLength)),
        final: ((body[1 + idLength] ?? 0) & 1) === 1,
        aborted: ((body[1 + idLength] ?? 0) & 2) === 2,
        bytes: body.subarray(2 + idLength),
      };
    }
    default:
      throw new FrameError(`unknown frame kind ${kind}`);
  }
};
