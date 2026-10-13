import { join } from "node:path";
import type { Options } from "@electron/packager";

export interface PackageTarget {
  readonly platform: "darwin" | "linux" | "win32";
  readonly arch: "arm64" | "x64";
}

export const packageTargets = (args: ReadonlyArray<string>): PackageTarget[] => {
  if (args.includes("--windows")) {
    if (args.includes("--linux")) throw new Error("--windows cannot be combined with --linux");

    if (!args.includes("--reuse-daemon"))
      throw new Error("Windows packaging requires --reuse-daemon from the macOS build");

    return [
      { platform: "win32", arch: "x64" },
      { platform: "win32", arch: "arm64" },
    ];
  }

  return [
    { platform: "darwin", arch: "arm64" },
    ...(args.includes("--linux") ? [{ platform: "linux", arch: "x64" } as const] : []),
  ];
};

export const targetOptions = (
  target: PackageTarget,
  icons: string
): Pick<Options, "icon" | "win32metadata" | "executableName"> => {
  const options: Pick<Options, "icon" | "win32metadata" | "executableName"> = {
    executableName: target.platform === "linux" ? "polaris" : "Polaris",
    icon: join(icons, target.platform === "win32" ? "Polaris.ico" : "Polaris.icns"),
  };

  if (target.platform === "win32")
    options.win32metadata = {
      CompanyName: "lux.dev LLC",
      FileDescription: "Polaris",
      InternalName: "Polaris",
      OriginalFilename: "Polaris.exe",
      ProductName: "Polaris",
    };

  return options;
};
