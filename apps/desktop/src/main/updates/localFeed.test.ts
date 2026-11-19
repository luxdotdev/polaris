import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { feedAnswer, serveLocalFeed, type FeedContent, type LocalFeed } from "./localFeed.ts";
import type { OfferedUpdate } from "./release.ts";
import { bytesOf, get } from "./updates.testing.ts";

const update: OfferedUpdate = {
  version: "0.5.0",
  url: "https://github.com/luxdotdev/polaris/releases/download/v0.5.0/Polaris-0.5.0-arm64-mac.zip",
  file: "Polaris-0.5.0-arm64-mac.zip",
  bytes: null,
  sha1: null,
  name: "October release",
  notes: "notes",
  pubDate: "2026-10-02T00:00:00Z",
};

const feed: FeedContent = {
  platform: "darwin",
  origin: "http://127.0.0.1:4100",
  token: "secret",
  update,
  bytes: 3000,
  sha1: null,
};

const local = {
  remoteAddress: "127.0.0.1",
  host: "127.0.0.1:4100",
  method: "GET",
  url: "/secret/feed",
};

test("the local feed refuses anything that is not this machine asking by its loopback name", () => {
  expect(feedAnswer(local, feed).status).toBe(200);
  expect(feedAnswer({ ...local, remoteAddress: "::ffff:127.0.0.1" }, feed).status).toBe(200);

  for (const remoteAddress of [
    "192.168.1.20",
    "10.0.0.4",
    "::ffff:192.168.1.20",
    "fe80::1",
    undefined,
  ])
    expect(feedAnswer({ ...local, remoteAddress }, feed)).toEqual({ status: 403 });

  // A page that rebinds its own name to 127.0.0.1 still sends that name as Host.
  for (const host of ["evil.example:4100", "localhost:4100", "127.0.0.1:9", undefined])
    expect(feedAnswer({ ...local, host }, feed)).toEqual({ status: 403 });

  expect(feedAnswer({ ...local, url: "/guess/feed" }, feed)).toEqual({ status: 404 });
  expect(feedAnswer({ ...local, url: "/secret/../etc/passwd" }, feed)).toEqual({ status: 404 });
  expect(feedAnswer({ ...local, method: "POST" }, feed)).toEqual({ status: 405 });
});

let dir = "";

let served: LocalFeed | null = null;

afterEach(() => {
  served?.close();
  served = null;
  rmSync(dir, { recursive: true, force: true });
});

const serve = async (platform: string, patch: Partial<OfferedUpdate> = {}) => {
  dir = mkdtempSync(join(tmpdir(), "polaris-local-feed-"));
  const path = join(dir, "package");
  writeFileSync(path, bytesOf(3000));
  served = await serveLocalFeed({
    platform,
    path,
    bytes: 3000,
    sha1: patch.sha1 ?? null,
    update: { ...update, ...patch },
  });

  return served.url;
};

const text = (body: Uint8Array) => new TextDecoder().decode(body);

test("macOS: Squirrel JSON on 127.0.0.1 naming the zip on the same loopback origin", async () => {
  const url = new URL(await serve("darwin"));

  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toMatch(/^\/[0-9a-f]{48}\/feed$/);
  const zipUrl = `${url.origin}${url.pathname.replace(/feed$/, "Polaris-0.5.0-arm64-mac.zip")}`;

  expect(JSON.parse(text((await get(url.href)).body))).toEqual({
    url: zipUrl,
    name: "October release",
    notes: "notes",
    pub_date: "2026-10-02T00:00:00Z",
  });
  const zip = await get(zipUrl);

  expect(zip.length).toBe("3000");
  expect(zip.body).toEqual(bytesOf(3000));
  expect(await get(zipUrl, "HEAD")).toMatchObject({ status: 200, length: "3000" });
  expect((await get(`${url.origin}/feed`)).status).toBe(404);
  expect((await get(zipUrl, "POST")).status).toBe(405);

  // Another name for this machine reaches the port, or doesn't, but is never served.
  const renamed = await get(`http://localhost:${url.port}${url.pathname}`).catch(() => null);

  expect(renamed?.status ?? 403).toBe(403);
});

test("Windows: RELEASES names the package beside it, with the hash Squirrel checks", async () => {
  const sha1 = "a".repeat(40);
  const file = "Polaris-x64-win-0.5.0-full.nupkg";
  const url = await serve("win32", { file, sha1 });
  const releases = await get(`${url}/RELEASES?id=Polaris&localVersion=0.4.0&arch=amd64`);

  expect(text(releases.body)).toBe(`${sha1} ${file} 3000`);
  expect((await get(`${url}/${file}`)).body).toEqual(bytesOf(3000));
});

test.skipIf(process.platform === "win32")(
  "a verified file swapped for a symlink, or for one of another size, is not served",
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "polaris-local-feed-"));
    const real = join(folder, "real");
    const link = join(folder, "package");

    writeFileSync(real, bytesOf(3000));
    symlinkSync(real, link);

    const tried = (path: string, bytes: number) =>
      serveLocalFeed({ platform: "darwin", path, bytes, sha1: null, update }).then(
        (feed) => {
          feed.close();

          return "served";
        },
        () => "refused"
      );

    expect(await tried(link, 3000)).toBe("refused");
    expect(await tried(real, 2999)).toBe("refused");
    expect(await tried(real, 3000)).toBe("served");
    rmSync(folder, { recursive: true, force: true });
  }
);

test("the package is served from the file as opened, whatever takes its place on disk", async () => {
  const url = await serve("darwin");

  rmSync(join(dir, "package"));
  writeFileSync(join(dir, "package"), "swapped");
  expect((await get(url.replace(/feed$/, "Polaris-0.5.0-arm64-mac.zip"))).body).toEqual(
    bytesOf(3000)
  );
});
