/**
 * What to do about the Daemon on a Host, decided from what is there and
 * what the Desktop App bundles. Pure, so every branch is unit-tested.
 */
import { Data } from "effect";
import {
  backgroundUpgradeDue,
  compareVersions,
  upgradeDue,
  type DaemonBuild,
  type Libc,
  MUSL_RUNTIME_PACKAGES,
  type Platform,
  platformFromUname,
} from "./builds.ts";
import type { WindowsShell } from "./windows/powershell.ts";

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
  /** What the Host can download and check a Release archive with; absent means nothing. */
  readonly tools?: HostTools;
  /** Windows only: the DefaultShell sshd runs commands through, which decides how stdin reaches them. */
  readonly windowsShell?: WindowsShell;
  /** Windows only: a DefaultShell we don't drive (its process name); the Host plans as Unsupported. */
  readonly unsupportedShell?: string;
}

export type FetchTool = "curl" | "wget";

export interface HostTools {
  readonly fetch: FetchTool | null;
  readonly tar: boolean;
  /** `sha256sum` or `shasum`. */
  readonly sha256: boolean;
}

/** How the build's files reach the Host. */
export type Delivery = Data.TaggedEnum<{
  /** The files are on this machine: stream them over SSH. */
  Upload: Record<never, never>;
  /** The Host downloads the Release archive itself; on any failure, `ClientFetch`. */
  HostFetch: { readonly tool: FetchTool };
  /** This machine downloads the archive into its cache, then uploads it. */
  ClientFetch: Record<never, never>;
}>;

export const Delivery = Data.taggedEnum<Delivery>();

/** Null when this app can neither upload nor download the build (a dev manifest without files). */
export const deliveryFor = (build: DaemonBuild, probe: HostProbe): Delivery | null => {
  if (build.bundled) return Delivery.Upload();

  if (build.archive === null) return null;
  const tools = probe.tools;

  return tools?.fetch && tools.tar && tools.sha256
    ? Delivery.HostFetch({ tool: tools.fetch })
    : Delivery.ClientFetch();
};

export type InstallTrigger =
  /** The user asked (added the Host, pressed Install / Retry). */
  | "user"
  /** A reconnect the Client started on its own: never installs. */
  | "background";

export interface PlanOptions {
  readonly trigger: InstallTrigger;
  /** SHA-256 values the user has approved for first install on this Host. */
  readonly approvedSha256: ReadonlySet<string>;
  /**
   * The Client's own machine, whose build ships inside the app the user runs:
   * a first install needs no approval, even on a background check.
   */
  readonly trusted?: boolean;
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
  /** `windowsShell`: a Windows Host's DefaultShell, which its install commands are written for. */
  Install: {
    readonly build: DaemonBuild;
    readonly delivery: Delivery;
    readonly windowsShell?: WindowsShell;
  };
  Upgrade: {
    readonly from: string;
    readonly build: DaemonBuild;
    readonly delivery: Delivery;
    readonly windowsShell?: WindowsShell;
  };
}>;

export const InstallPlan = Data.taggedEnum<InstallPlan>();

/** The plan for a Host that already runs a build of its platform. */
const planUpgrade = (
  installed: string,
  build: DaemonBuild,
  delivery: Delivery,
  options: PlanOptions,
  shell: { readonly windowsShell?: WindowsShell }
): InstallPlan => {
  // Upgrades need no new approval. A dev build replaces any other version (`upgradeDue`),
  // but a background check never installs an older dev build over a newer one.
  const due = options.trigger === "background" ? backgroundUpgradeDue : upgradeDue;

  if (due(installed, build.version))
    return InstallPlan.Upgrade({ from: installed, build, delivery, ...shell });

  if (compareVersions(installed, build.version) > 0)
    return InstallPlan.InstalledNewer({ installed, bundled: build.version });

  return InstallPlan.UpToDate({ version: build.version });
};

export const planInstall = (
  probe: HostProbe,
  builds: ReadonlyArray<DaemonBuild>,
  options: PlanOptions
): InstallPlan => {
  const platform = platformFromUname(probe.os, probe.arch, probe.libc);

  if (platform === null) return InstallPlan.Unsupported({ os: probe.os, arch: probe.arch });

  if (platform === "windows-x64" && probe.windowsShell === undefined) {
    return InstallPlan.Unsupported({
      os: `windows (sshd's DefaultShell is ${probe.unsupportedShell || "unknown"})`,
      arch: probe.arch,
    });
  }

  const build = builds.find((candidate) => candidate.platform === platform);

  const delivery = build === undefined ? null : deliveryFor(build, probe);

  if (build === undefined || delivery === null) return InstallPlan.MissingBuild({ platform });

  const shell = probe.windowsShell === undefined ? {} : { windowsShell: probe.windowsShell };

  if (probe.libc === "musl" && (probe.missingLibraries?.length ?? 0) > 0) {
    return InstallPlan.MissingLibraries({
      platform,
      libraries: probe.missingLibraries!,
      command: `apk add ${MUSL_RUNTIME_PACKAGES.join(" ")}`,
    });
  }

  if (probe.installed !== null && probe.installed.platform === platform)
    return planUpgrade(probe.installed.version, build, delivery, options, shell);

  const needsApproval = (reason: "first-install" | "background") =>
    InstallPlan.NeedsApproval({ platform, version: build.version, sha256: build.sha256, reason });

  if (options.trusted === true) return InstallPlan.Install({ build, delivery, ...shell });

  if (options.trigger === "background") return needsApproval("background");

  if (!options.approvedSha256.has(build.sha256)) return needsApproval("first-install");

  return InstallPlan.Install({ build, delivery, ...shell });
};
