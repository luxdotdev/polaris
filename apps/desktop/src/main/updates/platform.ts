import { dirname, join } from "node:path";

export const updatePlatform = (platform: string, arch: string): string | null => {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";

  if (platform === "win32" && (arch === "arm64" || arch === "x64")) return `win32-${arch}`;

  return null;
};

export const updateFeed = (
  base: string,
  platform: string,
  arch: string,
  version: string
): string => {
  const target = updatePlatform(platform, arch);

  if (target === null) throw new Error("unsupported update platform");

  return `${base}/api/update/${target}/${encodeURIComponent(version)}`;
};

export const windowsAppId = (arch: string): string => `com.squirrel.Polaris-${arch}-win.Polaris`;

export const revealAppPath = (platform: string, exe: string): string =>
  platform === "win32" ? exe : join(dirname(exe), "../..");
