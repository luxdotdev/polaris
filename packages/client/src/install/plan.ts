/**
 * What to do about the Daemon on a Host, decided from what is there and
 * what the Desktop App bundles. Pure, so every branch is unit-tested.
 */
import { compareVersions, type DaemonBuild, type Platform, platformFromUname } from "./builds.ts"

/** What `probeHost` found on the Host. */
export interface HostProbe {
  readonly os: string
  readonly arch: string
  /** `polaris version` of `~/.polaris/bin/current/polaris`, or null if none is installed. */
  readonly installed: { readonly version: string; readonly platform: string } | null
}

export type InstallTrigger =
  /** The user asked (added the Host, pressed Install / Retry). */
  | "user"
  /** A reconnect the Client started on its own: never installs. */
  | "background"

export interface PlanOptions {
  readonly trigger: InstallTrigger
  /** SHA-256 values the user has approved for first install on this Host. */
  readonly approvedSha256: ReadonlySet<string>
}

export type InstallPlan =
  | { readonly _tag: "Unsupported"; readonly os: string; readonly arch: string }
  | { readonly _tag: "MissingBuild"; readonly platform: Platform }
  | { readonly _tag: "UpToDate"; readonly version: string }
  /** The Host has a newer Daemon than this Client bundles; use it as is (capabilities decide). */
  | { readonly _tag: "InstalledNewer"; readonly installed: string; readonly bundled: string }
  /**
   * First install awaits the user's one-time approval of this exact build
   * (Needs Attention). Show `platform`, `version` and `sha256`.
   */
  | {
      readonly _tag: "NeedsApproval"
      readonly platform: Platform
      readonly version: string
      readonly sha256: string
      readonly reason: "first-install" | "background"
    }
  | { readonly _tag: "Install"; readonly build: DaemonBuild }
  | { readonly _tag: "Upgrade"; readonly from: string; readonly build: DaemonBuild }

export const planInstall = (
  probe: HostProbe,
  builds: ReadonlyArray<DaemonBuild>,
  options: PlanOptions,
): InstallPlan => {
  const platform = platformFromUname(probe.os, probe.arch)
  if (platform === null) return { _tag: "Unsupported", os: probe.os, arch: probe.arch }
  const build = builds.find((candidate) => candidate.platform === platform)
  if (build === undefined) return { _tag: "MissingBuild", platform }

  if (probe.installed !== null && probe.installed.platform === platform) {
    const order = compareVersions(probe.installed.version, build.version)
    if (order === 0) return { _tag: "UpToDate", version: build.version }
    if (order > 0) {
      return { _tag: "InstalledNewer", installed: probe.installed.version, bundled: build.version }
    }
    // An installed Daemon was approved when it was first installed; upgrades need no new approval.
    return { _tag: "Upgrade", from: probe.installed.version, build }
  }

  const needsApproval = (reason: "first-install" | "background") =>
    ({
      _tag: "NeedsApproval",
      platform,
      version: build.version,
      sha256: build.sha256,
      reason,
    }) as const
  if (options.trigger === "background") return needsApproval("background")
  if (!options.approvedSha256.has(build.sha256)) return needsApproval("first-install")
  return { _tag: "Install", build }
}
