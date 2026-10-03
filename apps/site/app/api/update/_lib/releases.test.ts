import { expect, test } from "bun:test";
import { fixture, zip, dmg } from "./fixtures.ts";
import {
  createReleaseSource,
  publishedRelease,
  RELEASE_API,
  RELEASE_TTL_MS,
  releaseAsset,
} from "./releases.ts";

test("decodes only a published stable Release and selects its exact assets", () => {
  const release = publishedRelease(fixture);
  expect(releaseAsset(release, "zip")).toBe(zip);
  expect(releaseAsset(release, "dmg")).toBe(dmg);

  for (const change of [
    { draft: true },
    { prerelease: true },
    { tag_name: "v1.2.3-rc.1" },
    { tag_name: "invalid" },
    { published_at: null },
    { published_at: "invalid" },
    { assets: null },
  ])
    expect(() => publishedRelease({ ...fixture, ...change })).toThrow();
});

test("refuses missing, duplicate, unuploaded, wrong platform and unsafe assets", () => {
  for (const assets of [
    [],
    [fixture.assets[0]!, fixture.assets[0]!],
    [{ ...fixture.assets[0]!, state: "new" }],
    [{ ...fixture.assets[0]!, name: "Polaris-1.2.3-x64-mac.zip" }],
    [{ ...fixture.assets[0]!, browser_download_url: "https://example.com/Polaris.zip" }],
    [{ ...fixture.assets[0]!, browser_download_url: zip.replace("v1.2.3", "v1.2.2") }],
    [{ ...fixture.assets[0]!, browser_download_url: `${zip}?token=private` }],
  ])
    expect(() => releaseAsset(publishedRelease({ ...fixture, assets }), "zip")).toThrow();
});

test("shares in-flight lookups, caches five minutes, then observes a new Release", async () => {
  let clock = 0;
  let calls = 0;

  const fetcher = Object.assign(
    async (url: string | URL | Request, options?: RequestInit) => {
      calls++;
      expect(url).toBe(RELEASE_API);
      expect(options?.cache).toBe("no-store");
      expect(options?.headers).toEqual({
        Accept: "application/vnd.github+json",
        "User-Agent": "Polaris-release-feed",
      });

      return Response.json({ ...fixture, name: `Release ${calls}` });
    },
    { preconnect() {} }
  );

  const latest = createReleaseSource(fetcher, () => clock);
  const first = await Promise.all([latest(), latest()]);
  expect(first[0]).toBe(first[1]);
  expect(calls).toBe(1);
  clock = RELEASE_TTL_MS - 1;
  expect((await latest())?.name).toBe("Release 1");
  clock++;
  expect((await latest())?.name).toBe("Release 2");
  expect(calls).toBe(2);
});

test("caches no published Release, but retries lookup errors and invalid payloads", async () => {
  for (const response of [
    new Response(null, { status: 429 }),
    Response.json({ ...fixture, draft: true }),
    Response.json({ malformed: true }),
  ]) {
    let calls = 0;

    const latest = createReleaseSource(
      Object.assign(
        async () => {
          calls++;

          return response.clone();
        },
        { preconnect() {} }
      )
    );

    expect(await latest().catch(() => "rejected")).toBe("rejected");
    expect(await latest().catch(() => "rejected")).toBe("rejected");
    expect(calls).toBe(2);
  }

  let calls = 0;

  const latest = createReleaseSource(
    Object.assign(
      async () => {
        calls++;

        return new Response(null, { status: 404 });
      },
      { preconnect() {} }
    )
  );

  expect(await latest()).toBeNull();
  expect(await latest()).toBeNull();
  expect(calls).toBe(1);
});
