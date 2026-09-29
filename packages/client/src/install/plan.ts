/**
 * What to do about the Daemon on a Host, decided from what is there and
 * what the Desktop App bundles. Pure, so every branch is unit-tested.
 */
import { Data } from "effect";
import {
  compareVersions,
  type DaemonBuild,
  type Libc,
  MUSL_RUNTIME_PACKAGES,
  type Platform,
  platformFromUname,
} from "./builds.ts";

/** What `probeHost` found on the Host. */
export interface HostProbe {
  readonly os: string;
  readonly arch: string;
  /** Linux only: the C library; absent means glibc (and on macOS it doesn't apply). */
  readonly libc?: Libc;
  /** musl only: runtime libraries the Daemon needs that the Host lacks (`MUSL_RUNTIME_LIBRARIES`). */
  readonly missingLibraries?: ReadonlyArray<string>;
  /** `polaris version` of `~/.polaris/bin/current/polaris`, or null if none is installed. */
  readonly installed: { readonly version: string; readonly platform: string } | null;
}

export type InstallTrigger =
  /** The user asked (added the Host, pressed Install / Retry). */
  | "user"
  /** A reconnect the Client started on its own: never installs. */
  | "background";

export interface PlanOptions {
  readonly trigger: InstallTrigger;
  /** SHA-256 values the user has approved for first install on this Host. */
  readonly approvedSha256: ReadonlySet<string>;
}

export type InstallPlan = Data.TaggedEnum<{
  Unsupported: { readonly os: string; readonly arch: string };
  MissingBuild: { readonly platform: Platform };
  /**
   * A musl Host without the shared libraries Bun's musl runtime needs.
   * Installing them needs root, so show `command` for an administrator to run
   * (Needs Attention), then retry.
   */
  MissingLibraries: {
    readonly platform: Platform;
    readonly libraries: ReadonlyArray<string>;
    readonly command: string;
  };
  UpToDate: { readonly version: string };
  /** The Host has a newer Daemon than this Client bundles; use it as is (capabilities decide). */
  InstalledNewer: { readonly installed: string; readonly bundled: string };
  /**
   * First install awaits the user's one-time approval of this exact build
   * (Needs Attention). Show `platform`, `version` and `sha256`.
   */
  NeedsApproval: {
    readonly platform: Platform;
    readonly version: string;
    readonly sha256: string;
    readonly reason: "first-install" | "background";
  };
  Install: { readonly build: DaemonBuild };
  Upgrade: { readonly from: string; readonly build: DaemonBuild };
}>;

export const InstallPlan = Data.taggedEnum<InstallPlan>();

export const planInstall = (
  probe: HostProbe,
  builds: ReadonlyArray<DaemonBuild>,
  options: PlanOptions
): InstallPlan => {
  const platform = platformFromUname(probe.os, probe.arch, probe.libc);

  if (platform === null) return InstallPlan.Unsupported({ os: probe.os, arch: probe.arch });
  const build = builds.find((candidate) => candidate.platform === platform);

  if (build === undefined) return InstallPlan.MissingBuild({ platform });

  if (probe.libc === "musl" && (probe.missingLibraries?.length ?? 0) > 0) {
    return InstallPlan.MissingLibraries({
      platform,
      libraries: probe.missingLibraries!,
      command: `apk add ${MUSL_RUNTIME_PACKAGES.join(" ")}`,
    });
  }

  if (probe.installed !== null && probe.installed.platform === platform) {
    const order = compareVersions(probe.installed.version, build.version);

    if (order === 0) return InstallPlan.UpToDate({ version: build.version });

    if (order > 0) {
      return InstallPlan.InstalledNewer({
        installed: probe.installed.version,
        bundled: build.version,
      });
    }

    // An installed Daemon was approved when it was first installed; upgrades need no new approval.
    return InstallPlan.Upgrade({ from: probe.installed.version, build });
  }

  const needsApproval = (reason: "first-install" | "background") =>
    InstallPlan.NeedsApproval({ platform, version: build.version, sha256: build.sha256, reason });

  if (options.trigger === "background") return needsApproval("background");

  if (!options.approvedSha256.has(build.sha256)) return needsApproval("first-install");

  return InstallPlan.Install({ build });
};
