import { Function, Schema } from "effect";
import { compareVersions, parseVersion } from "./version.ts";

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

const decodeReleases = Schema.decodeUnknownSync(Schema.Array(Release));

/** An Update's channel: Stable takes the latest stable Release, Nightly the newest of any. */
export type Channel = "stable" | "nightly";

export const RELEASE_API = "https://api.github.com/repos/luxdotdev/polaris/releases/latest";

/** Newest first by creation; 30 holds the 7 nightlies kept and the Releases between them. */
export const RELEASES_API = "https://api.github.com/repos/luxdotdev/polaris/releases?per_page=30";

/** Where a download goes when no stable Release can serve it: prereleases and notes live here. */
export const RELEASES_PAGE = "https://github.com/luxdotdev/polaris/releases";

/** A download with nothing to serve sends people to the Releases page instead of an error. */
export const releasesPage = () =>
  new Response(null, {
    status: 307,
    headers: { "Cache-Control": "no-store", Location: RELEASES_PAGE },
  });

export const RELEASE_TTL_MS = 300_000;

function validateRelease(release: typeof Release.Type, channel: Channel = "stable") {
  const version = parseVersion(release.tag_name.replace(/^v/, ""));
  const stable = !release.prerelease && version?.prerelease.length === 0;

  if (release.draft || !version || (channel === "stable" && !stable))
    throw new Error("Invalid published Release");

  if (!Number.isFinite(Date.parse(release.published_at))) throw new Error("Invalid Release date");

  return { ...release, version };
}

export const publishedRelease = Function.flow(decodeRelease, (release) => validateRelease(release));

export type ListedRelease = typeof Release.Type;

/** The Nightly channel's Release: the highest version published, prerelease or not. */
export function newestRelease(releases: ReadonlyArray<ListedRelease>): PublishedRelease | null {
  const published = releases.flatMap((release) =>
    !release.draft && parseVersion(release.tag_name.replace(/^v/, ""))
      ? [validateRelease(release, "nightly")]
      : []
  );

  return published.reduce<PublishedRelease | null>(
    (newest, release) =>
      newest && compareVersions(newest.version, release.version) >= 0 ? newest : release,
    null
  );
}

export type PublishedRelease = ReturnType<typeof publishedRelease>;

export type WindowsArch = "x64" | "arm64";

/** Squirrel's NuGet version drops the prerelease's dots, as tooling/release/metadata.py does. */
export const nugetVersion = (version: string): string => {
  const [core, ...prerelease] = version.split("+", 1)[0]!.split("-");

  return prerelease.length === 0 ? core! : `${core}-${prerelease.join("-").replaceAll(".", "")}`;
};

export const windowsAssetName = (
  version: string,
  arch: WindowsArch,
  kind: "setup" | "nupkg" | "releases"
): string => {
  if (kind === "nupkg") return `Polaris-${arch}-win-${nugetVersion(version)}-full.nupkg`;

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

const SOURCES = {
  stable: { url: RELEASE_API, read: publishedRelease },
  nightly: { url: RELEASES_API, read: Function.flow(decodeReleases, newestRelease) },
};

export function createReleaseSource(
  fetcher: typeof fetch = fetch,
  now = Date.now,
  channel: Channel = "stable"
) {
  const source = SOURCES[channel];

  let cached: { value: PublishedRelease | null; until: number } | undefined;
  let pending: Promise<PublishedRelease | null> | undefined;

  async function load() {
    const response = await fetcher(source.url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Polaris-release-feed" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    let value: PublishedRelease | null;

    if (response.status === 404) value = null;
    else {
      if (!response.ok) throw new Error("Release lookup failed");
      value = source.read(await response.json());
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

const sources = {
  stable: createReleaseSource(),
  nightly: createReleaseSource(fetch, Date.now, "nightly"),
};

/** The Release a channel's callers update to, cached per channel. */
export const latestRelease = (channel: Channel = "stable") => sources[channel]();

export const CHANNEL_ERROR = "Use channel=stable or channel=nightly.";

/** `?channel=nightly` or `?channel=stable`; absent means stable, anything else is null. */
export function requestChannel(request: Request): Channel | null {
  const channel = new URL(request.url).searchParams.get("channel");

  if (channel === null || channel === "stable") return "stable";

  return channel === "nightly" ? channel : null;
}
