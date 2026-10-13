import { Function, Schema } from "effect";
import { parseVersion } from "./version.ts";

const Release = Schema.Struct({
  tag_name: Schema.String,
  name: Schema.NullOr(Schema.String),
  body: Schema.NullOr(Schema.String),
  published_at: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  assets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      state: Schema.String,
      browser_download_url: Schema.String,
    })
  ),
});

const decodeRelease = Schema.decodeUnknownSync(Release);

export const RELEASE_API = "https://api.github.com/repos/luxdotdev/polaris/releases/latest";

/** Where a download goes when no stable Release can serve it: prereleases and notes live here. */
export const RELEASES_PAGE = "https://github.com/luxdotdev/polaris/releases";

/** A download with nothing to serve sends people to the Releases page instead of an error. */
export const releasesPage = () =>
  new Response(null, {
    status: 307,
    headers: { "Cache-Control": "no-store", Location: RELEASES_PAGE },
  });

export const RELEASE_TTL_MS = 300_000;

function validateRelease(release: typeof Release.Type) {
  const version = parseVersion(release.tag_name.replace(/^v/, ""));

  if (release.draft || release.prerelease || !version || version.prerelease.length > 0)
    throw new Error("Invalid published Release");

  if (!Number.isFinite(Date.parse(release.published_at))) throw new Error("Invalid Release date");

  return { ...release, version };
}

export const publishedRelease = Function.flow(decodeRelease, validateRelease);

export type PublishedRelease = ReturnType<typeof publishedRelease>;

export type WindowsArch = "x64" | "arm64";

export const windowsAssetName = (
  version: string,
  arch: WindowsArch,
  kind: "setup" | "nupkg" | "releases"
): string => {
  if (kind === "nupkg") return `Polaris-${arch}-win-${version}-full.nupkg`;

  return `Polaris-${version}-${arch}-win-${kind === "setup" ? "Setup.exe" : "RELEASES"}`;
};

export function releaseAsset(release: PublishedRelease, kind: "zip" | "dmg"): string {
  const suffix = kind === "zip" ? "arm64-mac.zip" : "arm64.dmg";

  return releaseAssetNamed(release, `Polaris-${release.version.text}-${suffix}`);
}

export function releaseAssetNamed(release: PublishedRelease, name: string): string {
  const matches = release.assets.filter(
    (asset) => asset.name === name && asset.state === "uploaded"
  );

  if (matches.length !== 1) throw new Error("Missing Release asset");
  const url = new URL(matches[0]!.browser_download_url);
  const path = `/luxdotdev/polaris/releases/download/${release.tag_name}/${name}`;

  if (
    url.origin !== "https://github.com" ||
    decodeURIComponent(url.pathname) !== path ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid Release asset URL");

  return url.href;
}

export function createReleaseSource(fetcher: typeof fetch = fetch, now = Date.now) {
  let cached: { value: PublishedRelease | null; until: number } | undefined;
  let pending: Promise<PublishedRelease | null> | undefined;

  async function load() {
    const response = await fetcher(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Polaris-release-feed" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    let value: PublishedRelease | null;

    if (response.status === 404) value = null;
    else {
      if (!response.ok) throw new Error("Release lookup failed");
      value = publishedRelease(await response.json());
    }

    cached = { value, until: now() + RELEASE_TTL_MS };

    return value;
  }

  return async (): Promise<PublishedRelease | null> => {
    if (cached && now() < cached.until) return cached.value;
    pending ??= load().finally(() => {
      pending = undefined;
    });

    return pending;
  };
}

export const latestRelease = createReleaseSource();
