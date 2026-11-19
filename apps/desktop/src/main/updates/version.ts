const CORE = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)`;

const PRERELEASE = String.raw`(?:alpha|beta|rc)`;

const assetVersion = new RegExp(
  String.raw`\/Polaris-(${CORE}(?:-${PRERELEASE}\.(?:0|[1-9]\d*))?)(?:-arm64-mac\.zip|-(?:x64|arm64)-win-Setup\.exe)$`
);

const nugetVersion = new RegExp(String.raw`^(${CORE})(?:-(${PRERELEASE})(0|[1-9]\d*))?$`);

/** A Squirrel NuGet version (`1.2.3-alpha1`) as the release's semver (`1.2.3-alpha.1`). */
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

const PRERELEASE_RANK = new Map([
  ["alpha", 0],
  ["beta", 1],
  ["rc", 2],
]);

/** `1.2.3` → [1, 2, 3, 3, 0]; a prerelease ranks below its release (`-alpha.1` → […, 0, 1]). */
const rank = (version: string): ReadonlyArray<number> | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(version);

  if (match === null) return null;

  const pre =
    match[4] === undefined ? [3, 0] : [PRERELEASE_RANK.get(match[4]) ?? 0, Number(match[5])];

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
