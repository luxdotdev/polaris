/**
 * `HostAccess`: how the Client acts on a Host outside its Daemon connection (run a shell
 * command, stream a file to it, open an interactive shell there), resolved once from the
 * Host's `HostTarget`, on top of the `Ssh` service's three Layers (ssh, wsl.exe, local sh).
 * Decisions: docs/adr/0045-platform-services.md.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { HostTarget } from "../HostConnection.ts";
import { Ssh, type SshError, type SshResult } from "../install/Ssh.ts";
import { resolveSshBinary, type SshOptions } from "../ssh.ts";
import { wslShellArgv } from "../wsl/command.ts";
import { wslInstallLayer, type WslInstallOptions } from "../wsl/install.ts";

/** Why a Host can't take an action: `ActionUnsupportedReason` names the case for copy. */
export const ActionUnsupportedReason = Schema.Literals([
  /** The local Host is the app's own dev Daemon or a given socket, not one Polaris installed. */
  "unmanaged-local",
  /** This Client can't have a local Host at all (Windows). */
  "local-unsupported",
  /** No interactive shell hand-off for this kind of Host. */
  "no-terminal",
]);

export type ActionUnsupportedReason = typeof ActionUnsupportedReason.Type;

export class HostActionUnsupported extends Schema.TaggedError<HostActionUnsupported>()(
  "HostActionUnsupported",
  {
    target: Schema.String,
    action: Schema.Literals(["exec", "terminal"]),
    reason: ActionUnsupportedReason,
    message: Schema.String,
  }
) {}

export interface ExecOptions {
  /** Streams this local file to the command's stdin. */
  readonly stdinFile?: string;
  readonly onStdinBytes?: (bytes: number) => void;
}

export type HostKind = "local" | "ssh" | "wsl";

/** One Host, already resolved: what the install flow, Start daemon and terminals use. */
export interface HostChannel {
  readonly kind: HostKind;
  /** For logs and errors: "ssh studio", "wsl Ubuntu", "local". */
  readonly describe: string;
  /** The name the install flow reports: the ssh alias, the distro, or "local". */
  readonly alias: string;
  /** The home of this Client's own installed Daemon; null for ssh and wsl. */
  readonly home: string | null;
  /** A first install needs no approval: only this machine's own installed Daemon (ADR 0041). */
  readonly trusted: boolean;
  /** Runs a POSIX `sh` command line there; fails only when the channel itself does. */
  readonly exec: (command: string, options?: ExecOptions) => Effect.Effect<SshResult, SshError>;
  /** The `Ssh` service bound to this Host, for the install flow (`probeHost`, `applyPlan`) with `alias`. */
  readonly ssh: Layer.Layer<Ssh>;
  /** The argv the Client's terminal runs for an interactive shell there. */
  readonly interactiveArgv: Effect.Effect<ReadonlyArray<string>, HostActionUnsupported>;
}

/** The three ways to run a command on a Host, each the existing `Ssh` service. */
export interface HostRunners {
  readonly ssh: Layer.Layer<Ssh>;
  readonly wsl: Layer.Layer<Ssh>;
  /** This machine itself, with `HOME` at its installed Daemon's home. */
  readonly local: (home: string) => Layer.Layer<Ssh>;
}

export interface HostAccessOptions {
  /** The Client platform; injectable for cross-platform tests. */
  readonly platform?: NodeJS.Platform | undefined;
  /** The system or configured ssh (`sshBinary`, Windows OpenSSH). */
  readonly ssh?: SshOptions;
  readonly wsl?: WslInstallOptions;
}

export interface HostAccessApi {
  readonly channel: (target: HostTarget) => Effect.Effect<HostChannel, HostActionUnsupported>;
}

const unsupported = (
  target: string,
  action: HostActionUnsupported["action"],
  reason: ActionUnsupportedReason,
  message: string
) => new HostActionUnsupported({ target, action, reason, message });

const channelOf = (
  fields: Omit<HostChannel, "exec" | "ssh">,
  layer: Layer.Layer<Ssh>
): HostChannel => ({
  ...fields,
  ssh: layer,
  exec: (command, options) =>
    Ssh.use((ssh) => ssh.exec(fields.alias, command, options)).pipe(Effect.provide(layer)),
});

/** Channels over the given runners; a Windows Client never gets a local one. */
export const makeHostAccess = (
  runners: HostRunners,
  options: Pick<HostAccessOptions, "platform" | "ssh"> = {}
): HostAccessApi => {
  const platform = options.platform ?? process.platform;
  const sshOptions = { ...options.ssh, platform };

  const local = (target: { readonly installedHome?: string }) => {
    if (platform === "win32") {
      return Effect.fail(
        unsupported("local", "exec", "local-unsupported", "this Client has no local Host")
      );
    }

    const home = target.installedHome;

    if (home === undefined) {
      return Effect.fail(
        unsupported(
          "local",
          "exec",
          "unmanaged-local",
          "the local Daemon isn't one Polaris installed"
        )
      );
    }

    return Effect.succeed(
      channelOf(
        {
          kind: "local",
          describe: "local",
          alias: "local",
          home,
          trusted: true,
          interactiveArgv: Effect.fail(
            unsupported("local", "terminal", "no-terminal", "no shell hand-off for the local Host")
          ),
        },
        runners.local(home)
      )
    );
  };

  return {
    channel: (target) =>
      HostTarget.$match(target, {
        Local: local,
        Ssh: ({ alias }) =>
          Effect.succeed(
            channelOf(
              {
                kind: "ssh",
                describe: `ssh ${alias}`,
                alias,
                home: null,
                trusted: false,
                interactiveArgv: Effect.succeed([resolveSshBinary(sshOptions), "--", alias]),
              },
              runners.ssh
            )
          ),
        Wsl: ({ distro }) =>
          Effect.succeed(
            channelOf(
              {
                kind: "wsl",
                describe: `wsl ${distro}`,
                alias: distro,
                home: null,
                trusted: false,
                interactiveArgv: Effect.succeed(wslShellArgv(distro)),
              },
              runners.wsl
            )
          ),
      }),
  };
};

/** What `HostAccess.test` runs for each command: a scripted result per target. */
export type ScriptedExec = (
  target: HostTarget,
  command: string,
  options: ExecOptions | undefined
) => Effect.Effect<SshResult, SshError>;

const scriptedRunner = (script: ScriptedExec, target: (alias: string) => HostTarget) =>
  Layer.succeed(
    Ssh,
    Ssh.of({ exec: (alias, command, options) => script(target(alias), command, options) })
  );

export class HostAccess extends Context.Service<HostAccess, HostAccessApi>()(
  "polaris/client/HostAccess"
) {
  /** Production: the system or configured ssh, `wsl.exe --exec`, and a local `/bin/sh`. */
  static readonly layer = (options: HostAccessOptions = {}) =>
    HostAccess.fromRunners(
      {
        ssh: Ssh.withOptions({ ...options.ssh, platform: options.platform }),
        wsl: wslInstallLayer(options.wsl),
        local: (home) => Ssh.local(home),
      },
      options
    );

  /** Channels over explicit runners: tests mix a real runner with fakes. */
  static readonly fromRunners = (
    runners: HostRunners,
    options: Pick<HostAccessOptions, "platform" | "ssh"> = {}
  ) => Layer.succeed(HostAccess, HostAccess.of(makeHostAccess(runners, options)));

  /** Every command answered by `script`, so nothing spawns: Machines tests on any OS. */
  static readonly test = (
    script: ScriptedExec,
    options: Pick<HostAccessOptions, "platform" | "ssh"> = {}
  ) =>
    HostAccess.fromRunners(
      {
        ssh: scriptedRunner(script, (alias) => HostTarget.Ssh({ alias })),
        wsl: scriptedRunner(script, (distro) => HostTarget.Wsl({ distro })),
        local: (home) =>
          scriptedRunner(script, () => HostTarget.Local({ socketPath: "", installedHome: home })),
      },
      options
    );
}
