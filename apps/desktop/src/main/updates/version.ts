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
