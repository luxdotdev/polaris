import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadUpdate, type DownloadInput } from "./download.ts";
import { bytesOf, serveAsset, type Asset } from "./updates.testing.ts";

const within = async <A>(run: (dir: string) => Promise<A>) => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-download-"));

  try {
    return await run(join(dir, "pending-update"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const input = (dir: string, asset: Asset, patch: Partial<DownloadInput> = {}): DownloadInput => ({
  fetch: (_url, init) => Promise.resolve(serveAsset(asset, init)),
  url: asset.url,
  dir,
  name: "Polaris-0.5.0-arm64-mac.zip",
  expectedBytes: null,
  signal: new AbortController().signal,
  onProgress: () => {},
  ...patch,
});

const asset = (): Asset => ({ url: "https://example.test/a.zip", bytes: bytesOf(8000) });

test("the finished file holds the asset's bytes; an older Release's leftovers are removed", () =>
  within(async (dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Polaris-0.4.9-arm64-mac.zip.part"), "stale");
    const result = await downloadUpdate(input(dir, asset()));

    expect(result).toEqual({
      ok: true,
      path: join(dir, "Polaris-0.5.0-arm64-mac.zip"),
      bytes: 8000,
    });
    expect(new Uint8Array(readFileSync(join(dir, "Polaris-0.5.0-arm64-mac.zip")))).toEqual(
      bytesOf(8000)
    );
    expect(readdirSync(dir)).toEqual(["Polaris-0.5.0-arm64-mac.zip"]);
  }));

test("a server silent past the stall limit is a failed download, not a hang", () =>
  within(async (dir) => {
    const silent = () =>
      Promise.resolve(
        new Response(new ReadableStream({ start: (c) => c.enqueue(bytesOf(100)) }), {
          headers: { "Content-Length": "8000" },
        })
      );

    const result = await downloadUpdate(input(dir, asset(), { fetch: silent, stallMs: 30 }));

    expect(result).toEqual({ ok: false, receivedBytes: 100, totalBytes: 8000 });
  }));

test("a size other than the one the feed promised is refused before a byte is kept", () =>
  within(async (dir) => {
    const result = await downloadUpdate(input(dir, asset(), { expectedBytes: 7999 }));

    expect(result.ok).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  }));

test("a body shorter than its Content-Length is not a finished download", () =>
  within(async (dir) => {
    const short = () =>
      Promise.resolve(new Response(bytesOf(100), { headers: { "Content-Length": "8000" } }));

    expect(await downloadUpdate(input(dir, asset(), { fetch: short }))).toEqual({
      ok: false,
      receivedBytes: 100,
      totalBytes: 8000,
    });
  }));

test("a partial file larger than the asset is dropped and the download starts over", () =>
  within(async (dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Polaris-0.5.0-arm64-mac.zip.part"), bytesOf(9000));
    const result = await downloadUpdate(input(dir, asset()));

    expect(result.ok).toBe(true);
    expect(new Uint8Array(readFileSync(join(dir, "Polaris-0.5.0-arm64-mac.zip")))).toEqual(
      bytesOf(8000)
    );
  }));

/** A body of `chunks`, sent with no Content-Length, as a chunked or hostile server does. */
const unsized = (chunks: ReadonlyArray<number>) => () => {
  const left = [...chunks];

  return Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        pull: (controller) => {
          const next = left.shift();

          if (next === undefined) controller.close();
          else controller.enqueue(bytesOf(next));
        },
      })
    )
  );
};

test.each([
  { limit: { expectedBytes: 4 }, chunks: [8], kept: 0 },
  { limit: { expectedBytes: 4 }, chunks: [3, 3, 2], kept: 3 },
  { limit: { maxBytes: 4 }, chunks: [2, 2, 2, 2], kept: 4 },
])(
  "a body larger than the file ($limit, chunks $chunks) is never written past it, and is deleted",
  ({ limit, chunks, kept }) =>
    within(async (dir) => {
      const written: Array<number> = [];

      const result = await downloadUpdate(
        input(dir, asset(), {
          ...limit,
          fetch: unsized(chunks),
          onProgress: () => {
            const part = join(dir, "Polaris-0.5.0-arm64-mac.zip.part");

            written.push(existsSync(part) ? statSync(part).size : 0);
          },
        })
      );

      expect(result.ok).toBe(false);
      expect(Math.max(...written)).toBe(kept);
      expect(readdirSync(dir)).toEqual([]);
    })
);

test("a resume names the file it started; a file that changed since starts over, unmixed", () =>
  within(async (dir) => {
    const remote: Asset = {
      url: "https://example.test/a.zip",
      bytes: bytesOf(8000),
      dropAfter: 3000,
    };

    const asked: Array<string | null> = [];

    const fetch: DownloadInput["fetch"] = (_url, init) => {
      asked.push(new Headers(init.headers).get("If-Range"));

      return Promise.resolve(serveAsset(remote, init));
    };

    expect((await downloadUpdate(input(dir, remote, { fetch }))).ok).toBe(false);
    // The Release's asset is replaced while the partial file waits.
    const replaced = bytesOf(8000).reverse();
    Object.assign(remote, { bytes: replaced, etag: '"second"' });

    expect((await downloadUpdate(input(dir, remote, { fetch }))).ok).toBe(true);
    expect(asked).toEqual([null, '"first"']);
    expect(new Uint8Array(readFileSync(join(dir, "Polaris-0.5.0-arm64-mac.zip")))).toEqual(
      replaced
    );
    expect(readdirSync(dir)).toEqual(["Polaris-0.5.0-arm64-mac.zip"]);
  }));

test("a partial file whose remote file can't be named again is not resumed", () =>
  within(async (dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Polaris-0.5.0-arm64-mac.zip.part"), bytesOf(100).reverse());
    const ranges: Array<string | null> = [];

    const result = await downloadUpdate(
      input(dir, asset(), {
        fetch: (_url, init) => {
          ranges.push(new Headers(init.headers).get("Range"));

          return Promise.resolve(serveAsset(asset(), init));
        },
      })
    );

    expect(result.ok).toBe(true);
    expect(ranges).toEqual([null]);
    expect(new Uint8Array(readFileSync(join(dir, "Polaris-0.5.0-arm64-mac.zip")))).toEqual(
      bytesOf(8000)
    );
  }));

test.skipIf(process.platform === "win32")(
  "the pending folder is private, and a symlink planted in it is replaced, never followed",
  () =>
    within(async (dir) => {
      const victim = join(dir, "..", "victim");

      mkdirSync(dir, { recursive: true, mode: 0o755 });
      writeFileSync(victim, "untouched");
      symlinkSync(victim, join(dir, "Polaris-0.5.0-arm64-mac.zip.part"));
      symlinkSync(victim, join(dir, "Polaris-0.5.0-arm64-mac.zip.part.validator"));

      expect((await downloadUpdate(input(dir, asset()))).ok).toBe(true);
      expect(readFileSync(victim, "utf8")).toBe("untouched");
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    })
);

test.skipIf(process.platform === "win32")(
  "a pending folder that is a symlink to another folder is refused",
  () =>
    within(async (dir) => {
      const elsewhere = join(dir, "..", "elsewhere");

      mkdirSync(elsewhere);
      symlinkSync(elsewhere, dir);

      expect((await downloadUpdate(input(dir, asset()))).ok).toBe(false);
      expect(readdirSync(elsewhere)).toEqual([]);
    })
);
