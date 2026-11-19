const CORE = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`;

/** Hand-cut prereleases, and a Nightly's build date (`0.12.1-nightly.20261119`, docs/adr/0057). */
const PRERELEASE = String.raw`(?:alpha|beta|rc|nightly)`;

const assetVersion = new RegExp(
  String.raw`\/Polaris-(${CORE}(?:-${PRERELEASE}\.(?:0|[1-9]\d*))?)(?:-arm64-mac\.zip|-(?:x64|arm64)-win-Setup\.exe)$`
);

const nugetVersion = new RegExp(String.raw`^(${CORE})(?:-(${PRERELEASE})(0|[1-9]\d*))?$`);

/** A Squirrel NuGet version (`1.2.3-alpha1`, `1.2.3-nightly20261119`) as the release's semver. */
export const versionFromNuget = (name: string): string | null => {
  const match = nugetVersion.exec(name);

  if (!match) return null;

  return match[2] === undefined ? match[1]! : `${match[1]}-${match[2]}.${match[3]}`;
};

/** The asset name is authoritative; a Release title can be arbitrary prose. */
export const versionFromAsset = (url: string): string | null => {
  const asset = assetVersion.exec(url)?.[1];

  if (asset !== undefined) return asset;
  const nupkg = /\/Polaris-(?:x64|arm64)-win-([^/]+)-full\.nupkg$/.exec(url)?.[1];

  return nupkg === undefined ? null : versionFromNuget(nupkg);
};

/** Semver's own order of these identifiers; a Release ranks above all of its prereleases. */
const PRERELEASE_RANK = new Map([
  ["alpha", 0],
  ["beta", 1],
  ["nightly", 2],
  ["rc", 3],
]);

const RELEASE_RANK = 4;

/** `1.2.3` → [1, 2, 3, 4, 0]; `1.2.3-nightly.20261119` → [1, 2, 3, 2, 20261119]. */
const rank = (version: string): ReadonlyArray<number> | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc|nightly)\.(\d+))?$/.exec(version);

  if (match === null) return null;

  const pre =
    match[4] === undefined
      ? [RELEASE_RANK, 0]
      : [PRERELEASE_RANK.get(match[4]) ?? 0, Number(match[5])];

  return [Number(match[1]), Number(match[2]), Number(match[3]), ...pre];
};

/** Whether `version` is a later Release than `than`; a version that can't be read is never newer. */
export const isNewer = (version: string, than: string): boolean => {
  const a = rank(version);
  const b = rank(than);

  if (a === null || b === null) return false;
  const at = a.findIndex((part, i) => part !== b[i]);

  return at !== -1 && (a[at] ?? 0) > (b[at] ?? 0);
};
