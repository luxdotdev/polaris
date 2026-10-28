import { describe, expect, test } from "bun:test";
import { Attachment, AttachmentId } from "@polaris/protocol";
import { type ImageCache, loadImage } from "./load.ts";

const image = (id: string, fields: Partial<Attachment> = {}) =>
  new Attachment({
    id: AttachmentId.make(id),
    name: `${id}.png`,
    mimeType: "image/png",
    size: 100,
    hostPath: `/staging/${id}.png`,
    width: 10,
    height: 10,
    ...fields,
  });

const memoryCache = () => {
  const files = new Map<string, Uint8Array>();

  const cache: ImageCache = {
    uri: (id) => (files.has(id) ? `file:///cache/${id}` : null),
    write: async (id, bytes) => {
      files.set(id, bytes);

      return `file:///cache/${id}`;
    },
  };

  return { cache, files };
};

describe("a message's image", () => {
  test("is read from the Host once, even when asked twice at once, then kept", async () => {
    const { cache, files } = memoryCache();
    const asked: Array<string> = [];

    const read = async (id: AttachmentId) => {
      asked.push(id);

      return new Uint8Array([1, 2, 3]);
    };

    const shot = image("a1");

    const [first, second] = await Promise.all([
      loadImage(cache, read, shot),
      loadImage(cache, read, shot),
    ]);

    expect([first, second]).toEqual(["file:///cache/a1", "file:///cache/a1"]);
    expect(asked).toEqual(["a1"]);
    expect(files.get("a1")).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("one the phone kept shows without a Host at all", async () => {
    const { cache } = memoryCache();

    await cache.write(AttachmentId.make("kept"), new Uint8Array([9]));

    expect(await loadImage(cache, null, image("kept"))).toBe("file:///cache/kept");
  });

  test.each([
    ["a file that isn't an image", image("doc", { mimeType: "application/pdf" })],
    ["an image too large to preview", image("huge", { size: 50_000_000 })],
  ])("never reads %s", async (_, attachment) => {
    const { cache } = memoryCache();
    let reads = 0;

    const read = async () => {
      reads++;

      return new Uint8Array();
    };

    expect(await loadImage(cache, read, attachment)).toBeNull();
    expect(reads).toBe(0);
  });

  test("one the Host can't read anymore shows as its name", async () => {
    const { cache } = memoryCache();

    expect(
      await loadImage(cache, () => Promise.reject(new Error("gone")), image("gone"))
    ).toBeNull();
  });
});
