import { describe, expect, test } from "bun:test";
import { pastedInto } from "./paste.ts";

const png = {
  uri: "file:///caches/polaris-paste/a.png",
  name: "pasted-1.png",
  mimeType: "image/png",
  size: 2048,
};

const jpeg = {
  uri: "file:///caches/polaris-paste/b.jpg",
  name: "pasted-2.jpg",
  mimeType: "image/jpeg",
  size: 4096,
};

describe("pastedInto", () => {
  test("each pasted image becomes an image pick for the field it was pasted into", () => {
    expect(
      pastedInto("composer-1", JSON.stringify({ fieldId: "composer-1", images: [png, jpeg] }))
    ).toEqual([
      { ...png, isImage: true },
      { ...jpeg, isImage: true },
    ]);
  });

  test("a paste into another composer's field attaches nothing here", () => {
    expect(
      pastedInto("composer-1", JSON.stringify({ fieldId: "composer-2", images: [png] }))
    ).toEqual([]);
  });

  test.each([
    [
      "a HEIC image",
      JSON.stringify({ fieldId: "composer-1", images: [{ ...png, mimeType: "image/heic" }] }),
    ],
    ["no images list", JSON.stringify({ fieldId: "composer-1" })],
    ["no JSON", "composer-1"],
  ])("a report with %s attaches nothing", (_, json) => {
    expect(pastedInto("composer-1", json)).toEqual([]);
  });
});
