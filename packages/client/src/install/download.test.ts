import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { packArchive } from "./archive.ts";
import type { DaemonBuild } from "./builds.ts";
import { downloadBuild } from "./download.ts";
import { RemoteInstallError } from "./remote.ts";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const binary = "#!/bin/sh\necho polaris\n";

const native = "native library";

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "polaris-download-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

/** A build whose manifest lists `polaris` and `libnative.so`, served as `served`. */
const release = (served: Uint8Array): DaemonBuild => ({
  platform: "linux-x64",
  version: "2.0.0",
  sha256: sha(binary),
  bundled: false,
  files: [
    { name: "polaris", path: "", sha256: sha(binary), size: binary.length, executable: true },
    { name: "libnative.so", path: "", sha256: sha(native), size: native.length, executable: false },
  ],
  archive: {
    name: "polaris-daemon-2.0.0-linux-x64.tar.gz",
    sha256: sha(served),
    size: served.length,
    url: "https://polaris.test/api/daemon/2.0.0/linux-x64",
  },
});

const archiveOf = (nativeBytes: string) =>
  packArchive([
    { name: "polaris", mode: 0o755, bytes: Buffer.from(binary) },
    { name: "libnative.so", mode: 0o644, bytes: Buffer.from(nativeBytes) },
  ]);

const serving = (respond: () => Response) => {
  const urls: string[] = [];

  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url);

      return respond();
    },
  };
};

const failure = (build: DaemonBuild, fetch: (url: string) => Promise<Response>) =>
  Effect.runPromise(downloadBuild({ cacheDir, fetch })(build, () => {}).pipe(Effect.flip));

const installed = () => join(cacheDir, "2.0.0", "linux-x64");

describe("downloadBuild refuses", () => {
  test("a body larger than the manifest's size, without reading the rest", async () => {
    const build = release(archiveOf(native));
    const chunk = new Uint8Array(1024);
    let pulled = 0;
    const progress: number[] = [];

    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += chunk.length;
        controller.enqueue(chunk);

        if (pulled >= 1024 * 1024) controller.close();
      },
    });

    const error = await Effect.runPromise(
      downloadBuild({ cacheDir, fetch: async () => new Response(body) })(build, (bytes) =>
        progress.push(bytes)
      ).pipe(Effect.flip)
    );

    expect(error.message).toBe(`the download is larger than ${build.archive!.size} bytes`);
    expect(pulled).toBeLessThan(build.archive!.size + 4 * chunk.length);
    expect(Math.max(...progress)).toBeLessThanOrEqual(build.archive!.size);
    expect(existsSync(installed())).toBe(false);
  });

  test("an archive whose files differ from the manifest, though the archive's own hash matches", async () => {
    const served = archiveOf("tampered library");
    const { fetch } = serving(() => new Response(new Uint8Array(served)));

    const error = await failure(release(served), fetch);

    expect(error).toEqual(
      new RemoteInstallError({
        alias: "this machine",
        step: "download",
        message: "libnative.so in the archive differs from this app's manifest",
      })
    );
    expect(existsSync(installed())).toBe(false);
  });

  test("a response that isn't 2xx, whatever its body", async () => {
    const build = release(archiveOf(native));
    const { fetch } = serving(() => new Response("<h1>Not Found</h1>", { status: 404 }));

    const error = await failure(build, fetch);

    expect(error.message).toBe(`${build.archive!.name}: HTTP 404`);
    expect(existsSync(installed())).toBe(false);
  });
});

test("a cached file that no longer matches the manifest is downloaded again", async () => {
  const served = archiveOf(native);
  const build = release(served);
  const { urls, fetch } = serving(() => new Response(new Uint8Array(served)));
  const download = downloadBuild({ cacheDir, fetch });

  await Effect.runPromise(download(build, () => {}));
  const cachedNative = join(installed(), "libnative.so");
  writeFileSync(cachedNative, "corrupted on disk");

  const again = await Effect.runPromise(download(build, () => {}));

  expect(urls).toHaveLength(2);
  expect(readFileSync(again.files[1]!.path, "utf8")).toBe(native);
});
