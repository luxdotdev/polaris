import { Context, Effect, Layer } from "effect"

export interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Runs short-lived commands (`launchctl`, `systemctl`, `loginctl`, a new
 * binary's `version`). A service so tests can script every call and never
 * touch the real service manager.
 */
export class CommandRunner extends Context.Service<
  CommandRunner,
  {
    readonly run: (
      argv: ReadonlyArray<string>,
      options?: { readonly timeoutMs?: number; readonly stdin?: string },
    ) => Effect.Effect<CommandResult>
  }
>()("polaris/daemon/service/CommandRunner") {
  static readonly layer = Layer.succeed(
    CommandRunner,
    CommandRunner.of({
      run: (argv, options) =>
        Effect.promise(async () => {
          try {
            const proc = Bun.spawn([...argv], {
              stdin: options?.stdin === undefined ? "ignore" : new Blob([options.stdin]),
              stdout: "pipe",
              stderr: "pipe",
              timeout: options?.timeoutMs ?? 15_000,
            })
            const [stdout, stderr, code] = await Promise.all([
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
              proc.exited,
            ])
            return { code, stdout, stderr }
          } catch (error) {
            // ENOENT and friends: report like a shell would rather than dying.
            return { code: 127, stdout: "", stderr: String(error) }
          }
        }),
    }),
  )
}
