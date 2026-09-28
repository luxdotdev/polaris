import { describe, expect, test } from "bun:test";
import {
  BLOB_CHUNK_BYTES,
  encodeBlob,
  encodeBlobFrame,
  encodeJsonFrame,
  FrameDecoder,
  FrameError,
} from "./frame.ts";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe("frames", () => {
  test("round-trips JSON and blob frames through arbitrary splits", () => {
    const blob = bytes(BLOB_CHUNK_BYTES * 2 + 17);
    const wire = [encodeJsonFrame('{"a":"é"}'), ...encodeBlob("b1", blob), encodeJsonFrame("{}")];
    const all = new Uint8Array(wire.reduce((n, f) => n + f.byteLength, 0));
    let o = 0;

    for (const f of wire) {
      all.set(f, o);
      o += f.byteLength;
    }

    const decoder = new FrameDecoder();
    const frames = [];

    for (let i = 0; i < all.byteLength; i += 7777)
      frames.push(...decoder.push(all.subarray(i, i + 7777)));

    expect(decoder.pendingBytes).toBe(0);
    expect(frames.map((f) => f.kind)).toEqual(["json", "blob", "blob", "blob", "json"]);
    expect(frames[0]).toEqual({ kind: "json", text: '{"a":"é"}' });
    const chunks = frames.filter((f) => f.kind === "blob");
    expect(chunks.map((c) => c.final)).toEqual([false, false, true]);
    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.bytes.byteLength, 0));
    let p = 0;

    for (const c of chunks) {
      joined.set(c.bytes, p);
      p += c.bytes.byteLength;
    }

    expect(joined).toEqual(blob);
  });

  test("an empty blob still sends a final frame", () => {
    const frames = new FrameDecoder().push([...encodeBlob("e", new Uint8Array())][0]!);
    expect(frames).toEqual([
      { kind: "blob", blobId: "e", final: true, aborted: false, bytes: new Uint8Array() },
    ]);
  });

  test("carries the aborted flag", () => {
    const [frame] = new FrameDecoder().push(encodeBlobFrame("x", new Uint8Array(), true, true));
    expect(frame).toMatchObject({ kind: "blob", blobId: "x", final: true, aborted: true });
  });

  test("rejects unknown kinds", () => {
    expect(() => new FrameDecoder().push(Uint8Array.of(0, 0, 0, 1, 9))).toThrow(FrameError);
  });
});
