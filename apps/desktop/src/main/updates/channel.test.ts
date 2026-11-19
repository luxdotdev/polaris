import { describe, expect, test } from "bun:test";
import { UPDATE_BASE_URL } from "./index.ts";
import { updateFeedUrl } from "./platform.ts";
import { bytesOf, fixture, serveAsset, until } from "./updates.testing.ts";

const NIGHTLY = "0.12.0-nightly.20261118";

const feed = (version: string) =>
  `${UPDATE_BASE_URL}/api/update/darwin-arm64/${encodeURIComponent(version)}`;

const zip = (version: string) =>
  `https://github.com/luxdotdev/polaris/releases/download/v${version}/Polaris-${version}-arm64-mac.zip`;

const offer = (version: string) =>
  Response.json({ url: zip(version), name: version, notes: "", pub_date: "2026-11-19T07:30:00Z" });

describe("the Channel in the feed request", () => {
  test.each([
    ["darwin", "arm64", "stable", `${UPDATE_BASE_URL}/api/update/darwin-arm64/0.11.0`],
    [
      "darwin",
      "arm64",
      "nightly",
      `${UPDATE_BASE_URL}/api/update/darwin-arm64/0.11.0?channel=nightly`,
    ],
    ["win32", "x64", "stable", `${UPDATE_BASE_URL}/api/update/win32-x64/0.11.0/RELEASES`],
    [
      "win32",
      "arm64",
      "nightly",
      `${UPDATE_BASE_URL}/api/update/win32-arm64/0.11.0/RELEASES?channel=nightly`,
    ],
  ] as const)("%s %s on %s", (platform, arch, channel, url) => {
    expect(updateFeedUrl(UPDATE_BASE_URL, platform, arch, "0.11.0", channel)).toBe(url);
  });

  test("a Nightly's version is URI-encoded in the path, never a query of its own", () => {
    expect(updateFeedUrl(UPDATE_BASE_URL, "darwin", "arm64", NIGHTLY, "nightly")).toBe(
      `${UPDATE_BASE_URL}/api/update/darwin-arm64/0.12.0-nightly.20261118?channel=nightly`
    );
  });

  test("the persisted Channel is asked on launch, and a switch saves it and checks at once", async () => {
    const f = fixture({ channel: "nightly" });

    expect(f.updates.get().channel).toBe("nightly");
    f.updates.start();
    await f.settled();
    expect(f.requests.map((r) => r.url)).toEqual([`${feed("0.4.0")}?channel=nightly`]);

    f.updates.setChannel("stable");
    expect(f.saves).toContainEqual({ appUpdateChannel: "stable" });
    expect(f.updates.get().channel).toBe("stable");
    await f.settled();
    expect(f.requests.map((r) => r.url)).toEqual([
      `${feed("0.4.0")}?channel=nightly`,
      feed("0.4.0"),
    ]);

    // Choosing the Channel it's already on asks nothing.
    f.updates.setChannel("stable");
    expect(f.requests).toHaveLength(2);
    f.cleanup();
  });
});

describe("leaving Nightly", () => {
  test.each([
    ["the feed says current", () => new Response(null, { status: 204 })],
    ["the feed offers an older Stable", () => offer("0.11.0")],
    [
      "the feed offers this Nightly's own Stable core's earlier Nightly",
      () => offer("0.12.0-nightly.20261101"),
    ],
  ])("never downgrades when %s", async (_, answer) => {
    const f = fixture({
      version: NIGHTLY,
      channel: "nightly",
      internet: (url) =>
        url === feed(NIGHTLY)
          ? Promise.resolve(answer())
          : Promise.reject(new Error(`unexpected request ${url}`)),
    });

    f.updates.setChannel("stable");
    await f.settled();
    expect(f.updates.get()).toMatchObject({
      phase: "current",
      channel: "stable",
      version: NIGHTLY,
      download: null,
      failure: null,
    });
    expect(f.requests.map((r) => r.url)).toEqual([feed(NIGHTLY)]);
    expect(f.native.checks).toBe(0);
    f.cleanup();
  });

  test("a newer Stable replaces the Nightly", async () => {
    const asset = { url: zip("0.12.0"), bytes: bytesOf(2000) };

    const f = fixture({
      version: NIGHTLY,
      channel: "nightly",
      internet: (url, init) =>
        url === feed(NIGHTLY)
          ? Promise.resolve(offer("0.12.0"))
          : Promise.resolve(serveAsset(asset, init)),
    });

    f.updates.setChannel("stable");
    await f.settled();
    await f.native.done;
    expect(f.updates.get()).toMatchObject({ phase: "ready", readyVersion: "0.12.0" });
    f.cleanup();
  });

  test("a Nightly downloading when Stable is chosen is dropped, and never reaches Squirrel", async () => {
    let started = false;

    const f = fixture({
      internet: (url, init) => {
        if (url === `${feed("0.4.0")}?channel=nightly`) return Promise.resolve(offer(NIGHTLY));

        if (url === feed("0.4.0")) return Promise.resolve(new Response(null, { status: 204 }));
        started = true;

        // The Nightly's zip never finishes; only the switch's abort ends it.
        return new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        );
      },
      channel: "nightly",
    });

    f.updates.check();
    await until(() => started);
    expect(f.updates.get().phase).toBe("downloading");

    f.updates.setChannel("stable");
    await f.settled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.updates.get()).toMatchObject({
      phase: "current",
      channel: "stable",
      download: null,
      readyVersion: null,
      failure: null,
    });
    expect(f.native.checks).toBe(0);
    f.cleanup();
  });

  test("an answer from the Channel just left is dropped, and the new Channel is asked", async () => {
    let answer: (response: Response) => void = () => undefined;

    const f = fixture({
      channel: "nightly",
      internet: (url) => {
        if (url === `${feed("0.4.0")}?channel=nightly`)
          return new Promise<Response>((resolve) => {
            answer = resolve;
          });

        if (url === feed("0.4.0")) return Promise.resolve(new Response(null, { status: 204 }));

        return Promise.reject(new Error(`unexpected request ${url}`));
      },
    });

    f.updates.check();
    f.updates.setChannel("stable");
    answer(offer(NIGHTLY));
    await until(() => f.requests.length === 2);
    await f.settled();
    expect(f.requests.map((r) => r.url)).toEqual([
      `${feed("0.4.0")}?channel=nightly`,
      feed("0.4.0"),
    ]);
    expect(f.updates.get()).toMatchObject({ phase: "current", availableVersion: null });
    f.cleanup();
  });
});
