/**
 * Install commands into a WSL distro: the `Ssh` service the install flow
 * (`../install/remote.ts`) runs its probe, upload and `polaris install` on,
 * each as `wsl.exe -d <distro> --exec /bin/sh -c <command>` with stdin streamed
 * from the local build file. The "alias" is the distro name.
 */
import { Effect, Layer } from "effect";
import { runCommand, Ssh, SshError, type SshResult } from "../install/Ssh.ts";
import {
  DISTRO_MISSING_PATTERN,
  WSL_MISSING_PATTERN,
  wslExecArgv,
  type WslOptions,
} from "./command.ts";
import { stripUtf16Nuls, wslEnv } from "./output.ts";

export interface WslInstallOptions extends WslOptions {
  readonly env?: Record<string, string | undefined>;
}

/** wsl.exe's own failure (no such distro, WSL missing) as an `SshError`, else the command's result. */
export const wslResult = (
  distro: string,
  result: SshResult
): Effect.Effect<SshResult, SshError> => {
  const stderr = stripUtf16Nuls(result.stderr);
  const message = stderr.trim().split(/\r?\n/)[0] ?? "";

  if (result.code !== 0 && DISTRO_MISSING_PATTERN.test(stderr)) {
    return Effect.fail(new SshError({ alias: distro, failure: "unreachable", message }));
  }

  if (result.code !== 0 && WSL_MISSING_PATTERN.test(stderr)) {
    return Effect.fail(new SshError({ alias: distro, failure: "spawn", message }));
  }

  return Effect.succeed({ ...result, stderr });
};

/** Runs install commands in the named distro; the alias passed to `exec` is the distro. */
export const wslInstallLayer = (options: WslInstallOptions = {}): Layer.Layer<Ssh> =>
  Layer.succeed(
    Ssh,
    Ssh.of({
      exec: (distro, command, execOptions) => {
        const [file, ...args] = wslExecArgv(distro, ["/bin/sh", "-c", command], options);

        return runCommand({
          alias: distro,
          // SAFETY: wslExecArgv always starts with the wsl binary.
          file: file as string,
          args,
          env: wslEnv(options.env),
          stdinFile: execOptions?.stdinFile,
          onStdinBytes: execOptions?.onStdinBytes,
          transportFailure: null,
        }).pipe(Effect.flatMap((result) => wslResult(distro, result)));
      },
    })
  );
