/**
 * Where the Daemon builds the app uploads to Hosts come from (see the
 * package README, "Daemon builds"): `POLARIS_DESKTOP_DAEMON_DIST`, then the
 * packaged app's `Resources/daemon`, then the repo's `apps/daemon/dist`. In
 * dev a missing platform is built from source on demand.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type DaemonBuild, loadBuilds, type Platform } from "@polaris/client/install";
import { Effect, Schema } from "effect";

export class BuildUnavailable extends Schema.TaggedError<BuildUnavailable>()("BuildUnavailable", {
  message: Schema.String,
}) {}

export interface BuildOptions {
  /** Dev: build a missing platform from source (only when the user asked). */
  readonly build: boolean;
  /** Runs before a build from source starts (it takes a minute). */
  readonly onBuild: Effect.Effect<void>;
}

export interface DaemonBuilds {
  /** Where the builds come from, for the README and the report. */
  readonly source: "env" | "bundled" | "repo" | "none";
  /** The builds, making sure `platform` is among them when this app can build it. */
  readonly forPlatform: (
    platform: Platform | null,
    options: BuildOptions
  ) => Effect.Effect<ReadonlyArray<DaemonBuild>, BuildUnavailable>;
}

export interface LocateInput {
  readonly env: Record<string, string | undefined>;
  /** `process.resourcesPath` when packaged, else null. */
  readonly resources: string | null;
  readonly repoRoot: string;
  /** Dev only: build a missing platform with `bun scripts/build-daemon.ts`. */
  readonly buildOnDemand: boolean;
}

const hasManifest = (dir: string) => existsSync(join(dir, "manifest.json"));

const load = (dir: string) =>
  Effect.try({
    try: () => (hasManifest(dir) ? loadBuilds(dir) : []),
    catch: (cause) =>
      new BuildUnavailable({ message: `unreadable daemon builds in ${dir}: ${String(cause)}` }),
  });

/** `bun scripts/build-daemon.ts <platform>`; merges into `apps/daemon/dist`. */
const buildFromSource = (repoRoot: string, platform: Platform) =>
  Effect.callback<void, BuildUnavailable>((resume) => {
    const child = spawn("bun", [join(repoRoot, "scripts/build-daemon.ts"), platform], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) =>
      resume(Effect.fail(new BuildUnavailable({ message: error.message })))
    );
    child.on("exit", (code) =>
      resume(
        code === 0
          ? Effect.void
          : Effect.fail(
              new BuildUnavailable({ message: `building the ${platform} daemon failed: ${stderr}` })
            )
      )
    );

    return Effect.sync(() => child.kill());
  });

export const locateBuilds = ({
  env,
  resources,
  repoRoot,
  buildOnDemand,
}: LocateInput): DaemonBuilds => {
  const fromEnv = env.POLARIS_DESKTOP_DAEMON_DIST;
  const bundled = resources === null ? null : join(resources, "daemon");
  const repo = join(repoRoot, "apps/daemon/dist");

  if (fromEnv !== undefined && fromEnv !== "") {
    return { source: "env", forPlatform: () => load(fromEnv) };
  }

  if (bundled !== null && hasManifest(bundled)) {
    return { source: "bundled", forPlatform: () => load(bundled) };
  }

  if (!buildOnDemand && !hasManifest(repo)) {
    return { source: "none", forPlatform: () => Effect.succeed([]) };
  }

  return {
    source: "repo",
    forPlatform: (platform, options) =>
      Effect.flatMap(load(repo), (builds) =>
        platform === null ||
        !buildOnDemand ||
        !options.build ||
        builds.some((b) => b.platform === platform)
          ? Effect.succeed(builds)
          : options.onBuild.pipe(
              Effect.andThen(buildFromSource(repoRoot, platform)),
              Effect.andThen(load(repo))
            )
      ),
  };
};
