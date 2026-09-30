/**
 * The install flow's side effects on a Host, over the system `ssh`: probe
 * and plan, then install or upgrade the bundled build, and restart an
 * installed Daemon's service. `Machines` decides when; these do it.
 */
import {
  applyPlan,
  type DaemonBuild,
  type InstallPlan,
  type InstallTrigger,
  planInstall,
  platformFromUname,
  probeHost,
  shScript,
  Ssh,
} from "@polaris/client/install";
import { Effect, Match, Option, Predicate, Schema } from "effect";
import type { DaemonBuilds } from "./builds.ts";
import type { InstallOutcome, InstallWork } from "./installFlow.ts";
import { reportOutcome } from "./views.ts";

export interface PlanInput {
  readonly alias: string;
  readonly trigger: InstallTrigger;
  readonly approved: ReadonlySet<string>;
  readonly builds: DaemonBuilds;
  /** Runs before a dev build from source starts. */
  readonly onBuild: Effect.Effect<void>;
}

export interface Planned {
  readonly plan: InstallPlan;
  /** The size of the build the plan would install, for the approval card. */
  readonly size: number | null;
}

const sizeOf = (build: DaemonBuild | undefined) =>
  build === undefined ? null : build.files.reduce((total, file) => total + file.size, 0);

/** Probe the Host, find (or in dev, build) its platform's build, and plan. */
export const planFor = Effect.fn("planFor")(function* (input: PlanInput) {
  const probe = yield* probeHost(input.alias);
  const platform = platformFromUname(probe.os, probe.arch, probe.libc);

  const builds = yield* input.builds.forPlatform(platform, {
    build: input.trigger === "user",
    onBuild: input.onBuild,
  });

  const plan = planInstall(probe, builds, {
    trigger: input.trigger,
    approvedSha256: input.approved,
  });

  return { plan, size: sizeOf(builds.find((b) => b.platform === platform)) } satisfies Planned;
});

/** Upload the build, check its SHA-256 on the Host, and run `polaris install|upgrade`. */
export const applyWork = (alias: string, work: InstallWork) =>
  Effect.map(applyPlan(alias, work), (applied): InstallOutcome =>
    Match.value(applied).pipe(
      Match.tagsExhaustive({
        Installed: ({ version, report }) =>
          reportOutcome(report, { kind: "installed", version, from: null }),
        Upgraded: ({ from, version, report }) =>
          reportOutcome(report, { kind: "upgraded", version, from }),
      })
    )
  );

export class StartFailed extends Schema.TaggedError<StartFailed>()("StartFailed", {
  message: Schema.String,
}) {}

const decodeReport = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

/** `polaris install --json` with the installed build: idempotent, it (re)starts the service. */
export const startDaemon = Effect.fn("startDaemon")(function* (alias: string) {
  const ssh = yield* Ssh;

  const result = yield* ssh.exec(
    alias,
    shScript('"$HOME/.polaris/bin/current/polaris" install --json')
  );

  const report = Option.getOrNull(decodeReport(result.stdout.trim().split("\n").at(-1) ?? ""));

  if (result.code === 0 && report?.ok === true) return;

  const message = Predicate.isString(report?.message)
    ? report.message
    : (result.stderr || result.stdout).trim();

  return yield* new StartFailed({ message: message || `exit ${result.code}` });
});

/** One line for a failure crossing into the install card. */
export const failureMessage = (error: { readonly message: string }): string =>
  error.message
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .at(-1) ?? error.message;
