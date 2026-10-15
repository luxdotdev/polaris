import { afterEach, describe, expect, test } from "bun:test";
import type { PolarisApi } from "../../../shared/api.ts";
import type { RequestInput } from "../../../shared/contract.ts";
import { PREVIEW_IMAGE_MAX_BYTES } from "../../../shared/languages.ts";
import { avif, gif, png, still } from "../../../shared/raster/fixtures.testing.ts";
import { readStaged } from "../attachments/previews.ts";
import { standInBridge } from "../bridge.ts";
import { readHostImage } from "./index.ts";

afterEach(() => standInBridge(null));

/** A Host whose every file holds `bytes`. */
const hostWith = (bytes: Uint8Array) =>
  standInBridge({
    request: () =>
      // SAFETY: `files.read` is the only method these readers call, and this is its shape.
      Promise.resolve({
        ok: true,
        value: { size: bytes.length, mimeType: null, content: { kind: "bytes", bytes } },
      }) as never,
    subscribe: () => () => undefined,
    onAppEvent: () => () => undefined,
  } satisfies PolarisApi);

/** A small GIF asking Chromium for a 4898 × 4898 canvas for each of its 300 frames. */
const costly = gif(
  4898,
  4898,
  Array.from({ length: 300 }, () => ({ width: 1, height: 1 }))
);

/** An AVIF whose 256-byte `ftyp` box begins with the ICO signature, so Blink decodes an ICO. */
const icoSniffed = avif([still(64, 64)], { brands: Array.from({ length: 60 }, () => "mif1") });

describe("a Host image is measured before the renderer decodes it", () => {
  test("one whose decode would pass the budget is too large, not shown", async () => {
    hostWith(costly);

    expect(await readHostImage("local", "/tmp/shot.png")).toEqual({ kind: "too-large" });
  });

  test("one Blink would sniff as a format the measure doesn't read fails", async () => {
    hostWith(icoSniffed);

    expect(await readHostImage("local", "/tmp/shot.avif")).toEqual({ kind: "failed" });
  });

  test("one within bounds is typed as its bytes sniff, whatever its name says", async () => {
    hostWith(png(64, 64));
    const image = await readHostImage("local", "/tmp/shot.jpg");

    expect(image.kind === "ready" ? image.blob.type : null).toBe("image/png");
  });

  test("one over the size cap is refused without its bytes crossing from the Host", async () => {
    const file = new Uint8Array(PREVIEW_IMAGE_MAX_BYTES * 4);
    file.set(png(64, 64));
    let sent = 0;
    standInBridge({
      request: (_method, input) => {
        // SAFETY: `files.read` is the only method this reader calls.
        const { offset, length } = input as RequestInput<"files.read">;
        const start = offset ?? 0;
        const bytes = file.subarray(start, length === null ? file.length : start + length);
        sent += bytes.length;

        // SAFETY: `files.read` is the only method this reader calls, and this is its shape.
        return Promise.resolve({
          ok: true,
          value: { size: file.length, mimeType: null, content: { kind: "bytes", bytes } },
        }) as never;
      },
      subscribe: () => () => undefined,
      onAppEvent: () => () => undefined,
    } satisfies PolarisApi);

    expect(await readHostImage("local", "/tmp/huge.png")).toEqual({ kind: "too-large" });
    expect(sent).toBeLessThanOrEqual(PREVIEW_IMAGE_MAX_BYTES);
  });

  test("a sent attachment's preview goes through the same measure", async () => {
    hostWith(costly);

    expect(
      await readStaged({ hostKey: "local", id: "a", hostPath: "/s/a.gif", mimeType: "image/gif" })
    ).toBeNull();
  });
});
