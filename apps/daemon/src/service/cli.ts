/**
 * The lifecycle subcommands of `polaris`: install, uninstall, upgrade.
 * Each prints a human summary, or with `--json` a single JSON line on stdout
 * that the Client parses (see packages/client/src/install).
 */
import { Effect, Schema } from "effect";
import { paths } from "../paths.ts";
import { CommandRunner } from "./CommandRunner.ts";
import {
  defaultInstallContext,
  type InstallError,
  install,
  pointCurrentAt,
  stageBinary,
  uninstall,
} from "./install.ts";
import { isCompiled, versionLine } from "./platform.ts";
import { requestUpgrade, runningDaemonPid, type UpgradeError, validateBinary } from "./upgrade.ts";

class UsageError extends Schema.TaggedError<UsageError>()("UsageError", {
  message: Schema.String,
}) {}

const flag = (args: ReadonlyArray<string>, name: string) => args.includes(name);
const option = (args: ReadonlyArray<string>, name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const output = (json: boolean, value: object, human: ReadonlyArray<string>) =>
  Effect.sync(() => console.log(json ? JSON.stringify(value) : human.join("\n")));

/** `polaris install [--binary <path>] [--json]` */
const installCommand = Effect.fn("installCommand")(function* (args: ReadonlyArray<string>) {
  const source = option(args, "--binary") ?? (isCompiled() ? process.execPath : undefined);
  if (source === undefined) {
    return yield* new UsageError({
      message: "install needs a compiled polaris binary; build one or pass --binary <path>",
    });
  }
  const info = yield* validateBinary(source);
  const report = yield* install(defaultInstallContext(paths().root), {
    source,
    version: info.version,
  });
  yield* output(flag(args, "--json"), { ok: true, action: "install", ...report }, [
    `Installed polaris ${report.version} at ${report.binary}`,
    `  sha256 ${report.sha256}`,
    `  service ${report.serviceFile} (${report.serviceDomain})${report.restarted ? ", restarted" : ""}`,
    ...(report.linger === "not-applicable" ? [] : [`  linger ${report.linger}`]),
    ...(report.supervisor === "fallback"
      ? [`  supervisor fallback (autostart: ${report.autostart.join(", ") || "none"})`]
      : []),
    ...report.notes.map((note) => `  note: ${note}`),
  ]);
});

/** `polaris uninstall [--purge] [--json]` */
const uninstallCommand = Effect.fn("uninstallCommand")(function* (args: ReadonlyArray<string>) {
  const report = yield* uninstall(defaultInstallContext(paths().root), {
    purge: flag(args, "--purge"),
  });
  yield* output(flag(args, "--json"), { ok: true, action: "uninstall", ...report }, [
    report.purged
      ? `Removed the Polaris service and ${paths().root}`
      : "Removed the Polaris service and binaries; state kept",
  ]);
});

/**
 * `polaris upgrade <path> [--json]`: install `<path>` as a new version, then
 * hand the running Daemon over to it in place (same PID, Harnesses kept).
 * With no Daemon running, it just (re)starts the service on the new version.
 */
const upgradeCommand = Effect.fn("upgradeCommand")(function* (args: ReadonlyArray<string>) {
  const source = args.find((arg) => !arg.startsWith("--"));
  if (source === undefined)
    return yield* new UsageError({ message: "usage: polaris upgrade <path>" });
  const json = flag(args, "--json");
  const ctx = defaultInstallContext(paths().root);
  const info = yield* validateBinary(source);
  const staged = yield* stageBinary(ctx, { source, version: info.version });
  yield* pointCurrentAt(ctx, info.version);
  const pid = runningDaemonPid();
  if (pid === null) {
    const report = yield* install(ctx, { source: staged.path, version: info.version });
    return yield* output(json, { ok: true, action: "started", ...report }, [
      `No Daemon was running; started polaris ${info.version} (${report.serviceDomain})`,
    ]);
  }
  const status = yield* requestUpgrade({ pid, binary: staged.path, version: info.version });
  yield* output(json, { ok: true, action: "handoff", version: info.version, pid: status.pid }, [
    `Daemon (PID ${status.pid}) is now polaris ${info.version}`,
  ]);
});

const commands: Record<
  string,
  (
    args: ReadonlyArray<string>
  ) => Effect.Effect<void, UsageError | InstallError | UpgradeError, CommandRunner>
> = {
  install: installCommand,
  uninstall: uninstallCommand,
  upgrade: upgradeCommand,
};

export const isServiceCommand = (command: string | undefined): command is string =>
  command !== undefined && command in commands;

/** Run a lifecycle subcommand; resolves to the process exit code. */
export const runServiceCommand = (command: string, args: ReadonlyArray<string>): Promise<number> =>
  Effect.runPromise(
    commands[command]!(args).pipe(
      Effect.as(0),
      Effect.catch((error) =>
        Effect.sync(() => {
          const message = "step" in error ? `${error.step}: ${error.message}` : error.message;
          if (flag(args, "--json")) {
            console.log(JSON.stringify({ ok: false, error: error._tag, message }));
          } else {
            console.error(`polaris ${command}: ${message}`);
          }
          return error._tag === "UsageError" ? 2 : 1;
        })
      ),
      Effect.provide(CommandRunner.layer)
    )
  );

export { versionLine };
