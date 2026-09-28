/**
 * Runs one command on a Host over OpenSSH, non-interactively. The Client
 * never answers prompts itself: `BatchMode=yes` turns a password, 2FA or
 * changed-host-key prompt into a failure that surfaces as Needs Attention.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { Context, Effect, Layer, Schema } from "effect";

export interface SshResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Why ssh itself failed (exit 255), as far as its stderr tells. */
export const SshFailure = Schema.Literals(["host-key", "auth", "unreachable", "spawn", "unknown"]);
export type SshFailure = typeof SshFailure.Type;

export class SshError extends Schema.TaggedError<SshError>()("SshError", {
  alias: Schema.String,
  failure: SshFailure,
  message: Schema.String,
}) {
  /** The user has to act (verify a host key, set up keys) before we can retry. */
  get needsAttention(): boolean {
    return this.failure === "host-key" || this.failure === "auth";
  }
}

export const classifySshFailure = (stderr: string): SshFailure => {
  if (/host key verification failed|remote host identification has changed/i.test(stderr))
    return "host-key";
  if (
    /permission denied|too many authentication failures|no supported authentication/i.test(stderr)
  )
    return "auth";
  if (
    /could not resolve hostname|connection refused|timed out|no route to host|network is unreachable|connection closed/i.test(
      stderr
    )
  )
    return "unreachable";
  return "unknown";
};

/** Single-quote `value` for a POSIX shell. */
export const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * Wrap a POSIX `sh` script so it runs the same whatever the user's login
 * shell is (bash, zsh, fish, csh all pass a single-quoted word through).
 */
export const shScript = (script: string): string => `sh -c ${shellQuote(script)}`;

export class Ssh extends Context.Service<
  Ssh,
  {
    /**
     * Run `command` (a remote shell command line) on `alias`. With
     * `stdinFile`, stream that local file to the command's stdin.
     * Fails with SshError only when ssh itself fails (exit 255).
     */
    readonly exec: (
      alias: string,
      command: string,
      options?: { readonly stdinFile?: string }
    ) => Effect.Effect<SshResult, SshError>;
  }
>()("polaris/client/install/Ssh") {
  /** The system `ssh`, honouring the user's ~/.ssh/config for the alias. */
  static readonly layer = Layer.succeed(
    Ssh,
    Ssh.of({
      exec: (alias, command, options) =>
        Effect.callback<SshResult, SshError>((resume) => {
          if (alias.startsWith("-")) {
            resume(
              Effect.fail(new SshError({ alias, failure: "spawn", message: "invalid alias" }))
            );
            return;
          }
          const child = spawn(
            "ssh",
            ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "--", alias, command],
            { stdio: [options?.stdinFile ? "pipe" : "ignore", "pipe", "pipe"] }
          );
          let stdout = "";
          let stderr = "";
          child.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
          });
          child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });
          if (options?.stdinFile && child.stdin) {
            // ssh exiting early (EPIPE) is reported through its exit code below.
            child.stdin.on("error", () => {});
            createReadStream(options.stdinFile).pipe(child.stdin);
          }
          child.on("error", (error) =>
            resume(Effect.fail(new SshError({ alias, failure: "spawn", message: error.message })))
          );
          child.on("close", (code) => {
            if (code === 255) {
              resume(
                Effect.fail(
                  new SshError({
                    alias,
                    failure: classifySshFailure(stderr),
                    message: stderr.trim(),
                  })
                )
              );
            } else {
              resume(Effect.succeed({ code: code ?? 1, stdout, stderr }));
            }
          });
          return Effect.sync(() => child.kill());
        }),
    })
  );
}
