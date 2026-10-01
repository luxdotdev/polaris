/**
 * Install and upgrade the Daemon on a Host over SSH:
 *
 *   probeHost      uname + `~/.polaris/bin/current/polaris version`, one round trip
 *   planInstall    (plan.ts) install / upgrade / nothing / needs approval
 *   applyPlan      upload the bundled build via ssh stdin, verify its SHA-256
 *                  on the Host, then `polaris install` or `polaris upgrade <path>`
 *   ensureDaemon   all three
 *
 * Nothing is downloaded on the Host and nothing needs sudo.
 */
import { randomBytes } from "node:crypto";
import { Data, Effect, Match, Option, Predicate, Schema } from "effect";
import { type DaemonBuild, MUSL_RUNTIME_LIBRARIES } from "./builds.ts";
import { type HostProbe, type InstallPlan, type PlanOptions, planInstall } from "./plan.ts";
import { Ssh, type SshError, shScript } from "./Ssh.ts";

export class RemoteInstallError extends Schema.TaggedError<RemoteInstallError>()(
  "RemoteInstallError",
  {
    alias: Schema.String,
    step: Schema.String,
    message: Schema.String,
  }
) {}

export const PROBE_SCRIPT = [
  `printf 'os=%s\\n' "$(uname -s)"`,
  `printf 'arch=%s\\n' "$(uname -m)"`,
  // musl's loader is /lib/ld-musl-<arch>.so.1; `ldd --version` says "musl" there too.
  `if ls /lib/ld-musl-* >/dev/null 2>&1 || (ldd --version 2>&1 | grep -qi musl); then echo libc=musl; ` +
    `for l in ${MUSL_RUNTIME_LIBRARIES.join(" ")}; do [ -e "/usr/lib/$l" ] || [ -e "/lib/$l" ] || printf 'missing=%s\\n' "$l"; done; fi`,
  `v=$("$HOME/.polaris/bin/current/polaris" version 2>/dev/null) && printf 'installed=%s\\n' "$v"`,
  "exit 0",
].join("; ");

export const parseProbe = (stdout: string): HostProbe | null => {
  const fields = new Map(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
  );

  const os = fields.get("os");
  const arch = fields.get("arch");

  if (!os || !arch) return null;
  const version = /^polaris (\S+) (\S+)$/.exec(fields.get("installed") ?? "");

  const missing = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("missing="))
    .map((line) => line.slice("missing=".length));

  const probe: HostProbe = {
    os,
    arch,
    installed: version ? { version: version[1]!, platform: version[2]! } : null,
  };

  if (fields.get("libc") !== "musl") return probe;

  return { ...probe, libc: "musl", missingLibraries: missing };
};

export const probeHost = Effect.fn("probeHost")(function* (alias: string) {
  const ssh = yield* Ssh;
  const result = yield* ssh.exec(alias, shScript(PROBE_SCRIPT));
  const probe = result.code === 0 ? parseProbe(result.stdout) : null;

  if (probe === null) {
    return yield* new RemoteInstallError({
      alias,
      step: "probe",
      message: `unexpected answer (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`,
    });
  }

  return probe;
});

const failed = (
  alias: string,
  step: string,
  result: { code: number; stderr: string; stdout: string }
) =>
  new RemoteInstallError({
    alias,
    step,
    message: `exit ${result.code}: ${(result.stderr || result.stdout).trim()}`,
  });

/** Upload every file of `build` into a fresh `~/.polaris/upload-<id>/`, verifying hashes there. */
const upload = Effect.fn("upload")(function* (alias: string, build: DaemonBuild) {
  const ssh = yield* Ssh;
  const dir = `.polaris/upload-${randomBytes(6).toString("hex")}`;

  for (const file of build.files) {
    const target = `"$HOME/${dir}/${file.name}"`;
    const mode = file.executable ? "755" : "644";

    const script = [
      "set -e",
      `mkdir -p "$HOME/${dir}"`,
      `cat > ${target}.part`,
      `chmod ${mode} ${target}.part`,
      `mv ${target}.part ${target}`,
      `(sha256sum ${target} 2>/dev/null || shasum -a 256 ${target}) | cut -d' ' -f1`,
    ].join("; ");

    const result = yield* ssh.exec(alias, shScript(script), { stdinFile: file.path });

    if (result.code !== 0) return yield* failed(alias, `upload ${file.name}`, result);
    const remoteSha = result.stdout.trim();

    if (remoteSha !== file.sha256) {
      return yield* new RemoteInstallError({
        alias,
        step: `upload ${file.name}`,
        message: `SHA-256 on the Host is ${remoteSha || "missing"}, expected ${file.sha256}`,
      });
    }
  }

  return { dir, binary: `"$HOME/${dir}/${build.files[0]!.name}"` };
});

const cleanUp = (alias: string, dir: string) =>
  Effect.gen(function* () {
    const ssh = yield* Ssh;
    yield* ssh.exec(alias, shScript(`rm -rf "$HOME/${dir}"`));
  }).pipe(Effect.ignore);

/** The JSON line `polaris install|upgrade --json` prints; its fields vary by action and version. */
export type DaemonReport = Schema.JsonObject;

const decodeReport = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

/** Run `polaris install|upgrade --json` and parse the JSON line it prints last. */
const runPolaris = Effect.fn("runPolaris")(function* (
  alias: string,
  step: string,
  command: string
) {
  const ssh = yield* Ssh;
  const result = yield* ssh.exec(alias, shScript(command));
  const line = result.stdout.trim().split("\n").at(-1) ?? "";

  const report: DaemonReport | null = Option.getOrNull(decodeReport(line));

  if (result.code !== 0 || report === null || report.ok !== true) {
    const message = Predicate.isString(report?.message) ? report.message : null;

    return yield* message
      ? new RemoteInstallError({ alias, step, message })
      : failed(alias, step, result);
  }

  return report;
});

export type ApplyResult = Data.TaggedEnum<{
  Installed: { readonly version: string; readonly report: DaemonReport };
  Upgraded: { readonly from: string; readonly version: string; readonly report: DaemonReport };
}>;

export const ApplyResult = Data.taggedEnum<ApplyResult>();

/** Carry out an `Install` or `Upgrade` plan. */
export const applyPlan = Effect.fn("applyPlan")(function* (
  alias: string,
  plan: Extract<InstallPlan, { _tag: "Install" | "Upgrade" }>
) {
  const uploaded = yield* upload(alias, plan.build);

  const run = Match.value(plan).pipe(
    Match.tagsExhaustive({
      Install: () =>
        runPolaris(alias, "install", `${uploaded.binary} install --json`).pipe(
          Effect.map((report) => ApplyResult.Installed({ version: plan.build.version, report }))
        ),
      Upgrade: (upgrade) =>
        runPolaris(
          alias,
          "upgrade",
          `"$HOME/.polaris/bin/current/polaris" upgrade ${uploaded.binary} --json`
        ).pipe(
          Effect.map((report) =>
            ApplyResult.Upgraded({ from: upgrade.from, version: plan.build.version, report })
          )
        ),
    })
  );

  return yield* run.pipe(Effect.ensuring(cleanUp(alias, uploaded.dir)));
});

export type EnsureResult = Data.TaggedEnum<{
  Ready: { readonly plan: InstallPlan; readonly applied: ApplyResult | null };
  /** Show inline on the Host as Needs Attention; call again with the SHA approved. */
  ApprovalNeeded: { readonly plan: Extract<InstallPlan, { _tag: "NeedsApproval" }> };
  Unavailable: {
    readonly plan: Extract<InstallPlan, { _tag: "Unsupported" | "MissingBuild" }>;
  };
  /** Needs Attention: an administrator must run `plan.command` on the Host, then retry. */
  HostSetupNeeded: { readonly plan: Extract<InstallPlan, { _tag: "MissingLibraries" }> };
}>;

export const EnsureResult = Data.taggedEnum<EnsureResult>();

/**
 * Make sure the Host runs a Daemon this Client can talk to: install (only
 * with the user's approval of the build's SHA-256, never on a background
 * reconnect), upgrade, or nothing.
 */
export const ensureDaemon = Effect.fn("ensureDaemon")(function* (
  alias: string,
  builds: ReadonlyArray<DaemonBuild>,
  options: PlanOptions
): Effect.fn.Return<EnsureResult, RemoteInstallError | SshError, Ssh> {
  const probe = yield* probeHost(alias);
  const plan = planInstall(probe, builds, options);

  const ready = (applied: ApplyResult | null): EnsureResult =>
    EnsureResult.Ready({ plan, applied });

  const decided = (result: EnsureResult) => Effect.succeed(result);

  return yield* Match.value(plan).pipe(
    Match.tagsExhaustive({
      NeedsApproval: (needs) => decided(EnsureResult.ApprovalNeeded({ plan: needs })),
      Unsupported: (unsupported) => decided(EnsureResult.Unavailable({ plan: unsupported })),
      MissingBuild: (missing) => decided(EnsureResult.Unavailable({ plan: missing })),
      MissingLibraries: (missing) => decided(EnsureResult.HostSetupNeeded({ plan: missing })),
      UpToDate: () => decided(ready(null)),
      InstalledNewer: () => decided(ready(null)),
      Install: (install) => Effect.map(applyPlan(alias, install), ready),
      Upgrade: (upgrade) => Effect.map(applyPlan(alias, upgrade), ready),
    })
  );
});
