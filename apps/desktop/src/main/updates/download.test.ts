import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
