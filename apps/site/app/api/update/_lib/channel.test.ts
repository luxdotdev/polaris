import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import type { WideEvent } from "../../../../lib/log";
import { fixture } from "./fixtures.ts";
import { createReleaseRoutes } from "./index.ts";
import {
  createReleaseSource,
  newestRelease,
  publishedRelease,
  RELEASES_API,
  releaseAsset,
  windowsAssetName,
  type Channel,
  type PublishedRelease,
} from "./releases.ts";
import { createWindowsRoutes } from "./windows.ts";

const DOWNLOAD = "https://github.com/luxdotdev/polaris/releases/download";

/** A published Release of `version` with its Mac and Windows x64 update assets. */
const releaseOf = (version: string, prerelease = version.includes("-")) => {
  const names = [
    `Polaris-${version}-arm64-mac.zip`,
    `Polaris-${version}-arm64.dmg`,
    windowsAssetName(version, "x64", "releases"),
    windowsAssetName(version, "x64", "nupkg"),
  ];

  return {
    ...fixture,
    tag_name: `v${version}`,
    name: `Polaris ${version}`,
    prerelease,
    assets: names.map((name) => ({
      name,
      state: "uploaded",
      browser_download_url: `${DOWNLOAD}/v${version}/${name}`,
    })),
  };
};

const decodeUpdate = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

const STABLE = "0.11.0";

const NIGHTLY = "0.11.1-nightly.20261119";

const feeds = (stable: string, nightly: string) => {
  const asked: Array<Channel> = [];

  const latest = async (channel: Channel): Promise<PublishedRelease | null> => {
    asked.push(channel);

    return channel === "stable"
      ? publishedRelease(releaseOf(stable))
      : newestRelease([releaseOf(nightly), releaseOf(stable)]);
  };

  return { asked, latest };
};

const quietLog = (events: Array<WideEvent> = []) => ({
  env: {},
  schedule: (run: () => Promise<void>) => void run(),
  emit: async (event: WideEvent) => {
    events.push(event);
  },
});

const macUpdate = async (version: string, query: string, stable = STABLE, nightly = NIGHTLY) => {
  const feed = feeds(stable, nightly);
  const events: Array<WideEvent> = [];
  const routes = createReleaseRoutes({ latest: feed.latest, log: quietLog(events) });

  const response = await routes.update(
    new Request(`https://polaris.lux.dev/api/update/darwin-arm64/${version}${query}`),
    { params: Promise.resolve({ version }) }
  );

  await Promise.resolve();

  return {
    status: response.status,
    url: response.status === 200 ? decodeUpdate(await response.json()).url : null,
    asked: feed.asked,
    events,
  };
};

describe("the update route's channel", () => {
  test.each([
    ["a stable caller on Nightly gets the newest nightly", STABLE, "?channel=nightly", NIGHTLY],
    [
      "an older nightly on Nightly gets the newest",
      "0.11.1-nightly.20261118",
      "?channel=nightly",
      NIGHTLY,
    ],
    ["an older stable caller on Stable gets Stable", "0.10.0", "", STABLE],
    ["?channel=stable is Stable", "0.10.0", "?channel=stable", STABLE],
  ])("%s", async (_, version, query, offered) => {
    const { status, url } = await macUpdate(version, query);

    expect(status).toBe(200);
    expect(url).toBe(`${DOWNLOAD}/v${offered}/Polaris-${offered}-arm64-mac.zip`);
  });

  test("a nightly caller on Stable is never offered the older Stable Release", async () => {
    expect((await macUpdate(NIGHTLY, "")).status).toBe(204);
    expect((await macUpdate(NIGHTLY, "?channel=stable")).status).toBe(204);
  });

  test("a nightly caller on Stable updates once a Stable Release is newer than its nightly", async () => {
    const { status, url } = await macUpdate(NIGHTLY, "", "0.11.1");

    expect(status).toBe(200);
    expect(url).toBe(`${DOWNLOAD}/v0.11.1/Polaris-0.11.1-arm64-mac.zip`);
  });

  test("Nightly offers a Stable Release newer than every nightly", async () => {
    const { status, url } = await macUpdate(NIGHTLY, "?channel=nightly", "0.11.1");

    expect(status).toBe(200);
    expect(url).toBe(`${DOWNLOAD}/v0.11.1/Polaris-0.11.1-arm64-mac.zip`);
  });

  test("the newest nightly is current on Nightly", async () => {
    expect((await macUpdate(NIGHTLY, "?channel=nightly")).status).toBe(204);
  });

  test("an unknown channel is a 400 without a lookup, and the event names no channel", async () => {
    const { status, asked, events } = await macUpdate(STABLE, "?channel=beta");

    expect(status).toBe(400);
    expect(asked).toEqual([]);
    expect(events[0]).toMatchObject({ channel: null, rejection: "invalid_channel" });
  });

  test("the wide event records the channel asked for", async () => {
    const { events } = await macUpdate(STABLE, "?channel=nightly");

    expect(events[0]).toMatchObject({ channel: "nightly", update: "available" });
  });

  test("the Mac download stays on Stable", async () => {
    const feed = feeds(STABLE, NIGHTLY);
    const routes = createReleaseRoutes({ latest: feed.latest, log: quietLog() });

    const response = await routes.download(
      new Request("https://polaris.lux.dev/download/mac?channel=nightly"),
      undefined
    );

    expect(response.headers.get("location")).toContain(`/v${STABLE}/`);
    expect(feed.asked).toEqual(["stable"]);
  });
});

describe("the Windows RELEASES route's channel", () => {
  const releases = async (version: string, query: string) => {
    const feed = feeds(STABLE, NIGHTLY);

    const routes = createWindowsRoutes({
      latest: feed.latest,
      log: quietLog(),
      fetch: async (url) => {
        const version = /\/v([^/]+)\//.exec(url)![1]!;

        return new Response(`${"a".repeat(40)} ${windowsAssetName(version, "x64", "nupkg")} 123\n`);
      },
    });

    const response = await routes.releases("x64")(
      new Request(`https://polaris.lux.dev/api/update/win32-x64/${version}/RELEASES${query}`),
      { params: Promise.resolve({ version }) }
    );

    return { status: response.status, body: await response.text(), asked: feed.asked };
  };

  test("Nightly offers the newest nightly's full package", async () => {
    const { status, body } = await releases(STABLE, "?channel=nightly");

    expect(status).toBe(200);
    expect(body).toContain(`/v${NIGHTLY}/Polaris-x64-win-0.11.1-nightly20261119-full.nupkg`);
  });

  test("a nightly caller on Stable gets no older Stable Release", async () => {
    expect((await releases(NIGHTLY, "")).status).toBe(204);
  });

  test("an unknown channel is a 400 without a lookup", async () => {
    const { status, asked } = await releases(STABLE, "?channel=canary");

    expect(status).toBe(400);
    expect(asked).toEqual([]);
  });
});

describe("the Nightly channel's Release", () => {
  test("is the highest version published, skipping drafts and tags that are not versions", () => {
    const newest = newestRelease([
      { ...releaseOf("0.11.1-nightly.20261120"), draft: true },
      { ...releaseOf("0.11.1-nightly.20261119"), tag_name: "nightly-latest" },
      releaseOf("0.11.1-nightly.20261118"),
      releaseOf("0.11.0"),
      releaseOf("0.11.1-nightly.20261117"),
    ]);

    expect(newest?.tag_name).toBe("v0.11.1-nightly.20261118");
    expect(releaseAsset(newest!, "zip")).toContain("/v0.11.1-nightly.20261118/");
  });

  test("none published is no Release", () => {
    expect(newestRelease([])).toBeNull();
  });

  test("is read from the Releases list, not GitHub's latest stable", async () => {
    const urls: Array<string | URL | Request> = [];

    const source = createReleaseSource(
      Object.assign(
        async (url: string | URL | Request) => {
          urls.push(url);

          return Response.json([releaseOf(NIGHTLY), releaseOf(STABLE)]);
        },
        { preconnect() {} }
      ),
      Date.now,
      "nightly"
    );

    expect((await source())?.version.text).toBe(NIGHTLY);
    expect(urls).toEqual([RELEASES_API]);
  });
});
