import { expect, test } from "bun:test";
import type { WideEvent } from "../../../../lib/log";
import { fixture } from "./fixtures.ts";
import {
  publishedRelease,
  releaseAssetNamed,
  RELEASES_PAGE,
  windowsAssetName,
  type WindowsArch,
} from "./releases.ts";
import { createWindowsRoutes, windowsDownloadArch, windowsReleases } from "./windows.ts";

const assets = (["x64", "arm64"] as const).flatMap((arch) =>
  (["setup", "nupkg", "releases"] as const).map((kind) => {
    const name = windowsAssetName("1.2.3", arch, kind);

    return {
      name,
      state: "uploaded",
      browser_download_url: `https://github.com/luxdotdev/polaris/releases/download/v1.2.3/${name}`,
    };
  })
);

const release = publishedRelease({ ...fixture, assets });

const manifest = (arch: WindowsArch) =>
  `${"a".repeat(40)} ${windowsAssetName("1.2.3", arch, "nupkg")} 123\n`;

const setup = (patch: Partial<Parameters<typeof createWindowsRoutes>[0]> = {}) => {
  const requests: string[] = [];
  const callbacks: Array<() => Promise<void>> = [];
  const events: WideEvent[] = [];

  const routes = createWindowsRoutes({
    latest: async () => release,
    fetch: async (url) => {
      requests.push(url);

      return new Response(manifest(url.includes("arm64") ? "arm64" : "x64"));
    },
    log: {
      env: {},
      schedule: (run) => {
        callbacks.push(run);
      },
      emit: async (event) => {
        events.push(event);
      },
    },
    ...patch,
  });

  return { routes, requests, callbacks, events };
};

test.each(["x64", "arm64"] as const)(
  "%s feed serves Squirrel RELEASES with an absolute package URL",
  async (arch) => {
    const { routes, requests, callbacks, events } = setup();

    const response = await routes.releases(arch)(
      new Request("https://polaris.lux.dev/feed", {
        headers: {
          "X-Polaris-Windows-Version": "10.0.26100",
          "X-Polaris-Install-ID": "58baf1dc-3772-4353-86b3-3a8a49219521",
        },
      }),
      { params: Promise.resolve({ version: "1.2.2" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const packageURL = releaseAssetNamed(release, windowsAssetName("1.2.3", arch, "nupkg"));
    expect(await response.text()).toBe(`${"a".repeat(40)} ${packageURL} 123\n`);
    expect(requests).toEqual([
      releaseAssetNamed(release, windowsAssetName("1.2.3", arch, "releases")),
    ]);
    await callbacks[0]!();
    expect(events[0]).toMatchObject({
      arch,
      platform: "win32",
      windows_version: "10.0.26100",
      status_code: 200,
    });
    expect(events[0]).not.toHaveProperty("macos_version");
  }
);

test.each(["1.2.3", "1.2.3+local", "2.0.0", "invalid"])(
  "%s avoids manifest fetch and cannot downgrade",
  async (version) => {
    const { routes, requests } = setup();

    const response = await routes.releases("arm64")(new Request("https://polaris.lux.dev/"), {
      params: Promise.resolve({ version }),
    });

    expect(response.status).toBe(version === "invalid" ? 400 : 204);
    expect(requests).toHaveLength(0);
  }
);

test("rejects wrong architecture, extra entries, injected URLs, invalid hashes/sizes and unsafe assets", () => {
  for (const body of [
    manifest("x64"),
    `${manifest("arm64")}${manifest("arm64")}`,
    manifest("arm64").replace("Polaris-arm64-win-1.2.3-full.nupkg", "https://evil.test/a.nupkg"),
    manifest("arm64").replace("a".repeat(40), "z".repeat(40)),
    manifest("arm64").replace(" 123", " 0"),
  ])
    expect(() => windowsReleases(release, "arm64", body)).toThrow();
  const name = windowsAssetName("1.2.3", "arm64", "nupkg");

  for (const candidates of [
    [],
    [assets[4]!, assets[4]!],
    [{ ...assets[4]!, browser_download_url: "https://evil.test/a.nupkg" }],
  ])
    expect(() =>
      releaseAssetNamed(publishedRelease({ ...fixture, assets: candidates }), name)
    ).toThrow();
});

test("missing Releases, upstream failure or missing nupkg fails closed", async () => {
  for (const patch of [
    { latest: async () => null },
    { fetch: async () => new Response(null, { status: 404 }) },
    { fetch: async () => new Response("malformed") },
    { latest: async () => publishedRelease({ ...fixture, assets: [] }) },
  ]) {
    const { routes } = setup(patch);

    const response = await routes.releases("x64")(new Request("https://polaris.lux.dev/"), {
      params: Promise.resolve({ version: "1.2.2" }),
    });

    expect(response.status).toBe("latest" in patch && (await patch.latest()) === null ? 204 : 503);
  }
});

test("download selects explicit arch, Client hints or ARM UA, with x64 emulation fallback", async () => {
  const { routes } = setup();

  for (const arch of ["x64", "arm64"] as const) {
    const response = await routes.download(
      new Request(`https://polaris.lux.dev/download/windows?arch=${arch}`),
      undefined
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      releaseAssetNamed(release, windowsAssetName("1.2.3", arch, "setup"))
    );
  }

  expect(
    windowsDownloadArch(
      new Request("https://polaris.lux.dev/", { headers: { "sec-ch-ua-arch": '"arm"' } })
    )
  ).toBe("arm64");
  expect(
    windowsDownloadArch(
      new Request("https://polaris.lux.dev/", {
        headers: { "user-agent": "Windows NT 10.0; ARM64" },
      })
    )
  ).toBe("arm64");
  expect(windowsDownloadArch(new Request("https://polaris.lux.dev/"))).toBe("x64");
  expect(
    (await routes.download(new Request("https://polaris.lux.dev/?arch=ia32"), undefined)).status
  ).toBe(400);
});

test("a macOS-only Release or no Release sends the download to the Releases page, never a broken asset", async () => {
  for (const latest of [async () => publishedRelease(fixture), async () => null]) {
    const { routes } = setup({ latest });

    for (const url of ["/download/windows", "/download/windows?arch=arm64"]) {
      const response = await routes.download(
        new Request(new URL(url, "https://polaris.lux.dev")),
        undefined
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(RELEASES_PAGE);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  }
});
