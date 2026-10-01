/**
 * The Betterleaks release Polaris ships beside `polaris` (MIT,
 * github.com/betterleaks/betterleaks). Hashes are copied from the release's
 * `checksums.txt`; a bump changes the version, every hash, and the licence
 * audit of its Go modules (`bun scripts/betterleaks.ts audit`).
 */
export const BETTERLEAKS_VERSION = "2.0.0-rc.1";

export const BETTERLEAKS_RELEASE = `https://github.com/betterleaks/betterleaks/releases/download/v${BETTERLEAKS_VERSION}`;

/** The binaries are static Go (`CGO_ENABLED=0`): one Linux file serves glibc and musl. */
export const BETTERLEAKS_ASSETS = {
  "darwin-arm64": {
    asset: `betterleaks_${BETTERLEAKS_VERSION}_darwin_arm64.tar.gz`,
    sha256: "666b96714a4d4e01d4007030bdbfbea9579a356585c0d45b1dfead0faf47a380",
  },
  "linux-x64": {
    asset: `betterleaks_${BETTERLEAKS_VERSION}_linux_x64.tar.gz`,
    sha256: "ccbbf68d0a403af44ed5d118c495d20c06bbf39d09129d2ae733d69aa9242404",
  },
  "linux-arm64": {
    asset: `betterleaks_${BETTERLEAKS_VERSION}_linux_arm64.tar.gz`,
    sha256: "88e96e09b0c44dd45c2991173340e035850a700040f8fa894cb53f745b4cb56b",
  },
} as const;

export type BetterleaksAsset = keyof typeof BETTERLEAKS_ASSETS;

/** The asset for a Polaris platform (`linux-x64-musl` uses the static `linux-x64` build). */
export const betterleaksAsset = (platform: string): BetterleaksAsset | null => {
  const base = platform.replace(/-musl$/, "");

  return isAsset(base) ? base : null;
};

const isAsset = (name: string): name is BetterleaksAsset => Object.hasOwn(BETTERLEAKS_ASSETS, name);
