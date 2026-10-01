import { describe, expect, test } from "bun:test";
import { isPreviewable, Lru, MAX_PREVIEW_BYTES, previewBox } from "./preview.ts";

describe("attachment previews", () => {
  test("one image fits 240×180 by its stored size, never scaled up", () => {
    expect(previewBox({ width: 2400, height: 1200 }, 1)).toEqual({ width: 240, height: 120 });
    expect(previewBox({ width: 600, height: 1200 }, 1)).toEqual({ width: 90, height: 180 });
    expect(previewBox({ width: 64, height: 32 }, 1)).toEqual({ width: 64, height: 32 });
  });

  test("several images fit 112×112 each; an unknown size takes a square", () => {
    expect(previewBox({ width: 2400, height: 1200 }, 3)).toEqual({ width: 112, height: 56 });
    expect(previewBox({ width: null, height: null }, 1)).toEqual({ width: 180, height: 180 });
    expect(previewBox({ width: null, height: null }, 2)).toEqual({ width: 112, height: 112 });
  });

  test("a very thin image keeps a clickable minimum", () => {
    expect(previewBox({ width: 4000, height: 10 }, 1)).toEqual({ width: 240, height: 24 });
  });

  test("only formats Chromium decodes, under the size cap", () => {
    expect(isPreviewable({ mimeType: "image/png", size: 10 })).toBe(true);
    expect(isPreviewable({ mimeType: "image/svg+xml", size: 10 })).toBe(false);
    expect(isPreviewable({ mimeType: "application/pdf", size: 10 })).toBe(false);
    expect(isPreviewable({ mimeType: "image/jpeg", size: MAX_PREVIEW_BYTES + 1 })).toBe(false);
  });

  test("the LRU releases what it evicts, least recently used first", () => {
    const released: Array<string> = [];
    const lru = new Lru<string>(2, (v) => released.push(v));

    lru.set("a", "A");
    lru.set("b", "B");
    lru.get("a");
    lru.set("c", "C");
    expect(released).toEqual(["B"]);
    expect(lru.size).toBe(2);
    lru.set("a", "A2");
    expect(released).toEqual(["B", "A"]);
  });
});
