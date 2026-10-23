/**
 * `polaris tailscale on|off|status`: Remote Access from a shell on the Host. Tailscale holds the
 * state, so this runs the same code as the Daemon's RPCs without going through it.
 */
import type { RemoteAccessStatus } from "@polaris/protocol";
import { Effect, Match } from "effect";
import { polarisHome } from "../paths.ts";
import { REASON_MESSAGES, RemoteAccessControl, type RemoteAccessOptions } from "./index.ts";

const USAGE = "usage: polaris tailscale <on|off|status>";

/** What `status` prints, one fact per line. */
export const describe = (status: RemoteAccessStatus): string =>
  Match.value(status.state).pipe(
    Match.when("on", () =>
      status.reason !== null
        ? `Remote access is on, but: ${REASON_MESSAGES[status.reason]}`
        : [
            `Remote access is on: https://${status.hostName ?? ""}/polaris`,
            `Extensions connect to ${status.url ?? ""}`,
          ].join("\n")
    ),
    Match.when("off", () =>
      status.reason === null
        ? "Remote access is off. Turn it on with `polaris tailscale on`."
        : `Remote access is off. ${REASON_MESSAGES[status.reason]}`
    ),
    Match.when(
      "unavailable",
      () =>
        `Remote access is unavailable. ${status.reason === null ? "" : REASON_MESSAGES[status.reason]}`
    ),
    Match.exhaustive
  );

/** The subcommand's effect: what it prints and its exit code. */
const commandFor = (
  subcommand: string | undefined,
  out: (line: string) => void,
  err: (line: string) => void
): Effect.Effect<number, never, RemoteAccessControl> =>
  Effect.gen(function* () {
    const control = yield* RemoteAccessControl;

    const report = (status: RemoteAccessStatus) => {
      out(describe(status));

      return status.reason === null ? 0 : 1;
    };

    const change = (effect: typeof control.enable) =>
      effect.pipe(
        Effect.map(report),
        Effect.catchTag("RemoteAccessError", (error) =>
          Effect.sync(() => {
            err(`polaris tailscale: ${error.message}`);

            return 1;
          })
        )
      );

    return yield* Match.value(subcommand).pipe(
      Match.when("status", () => Effect.map(control.status, report)),
      Match.when("on", () => change(control.enable)),
      Match.when("off", () => change(control.disable)),
      Match.orElse(() =>
        Effect.sync(() => {
          err(USAGE);

          return 2;
        })
      )
    );
  });

export const runTailscaleCommand = (
  args: ReadonlyArray<string>,
  options: RemoteAccessOptions = { root: polarisHome() },
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error
): Promise<number> =>
  Effect.runPromise(
    commandFor(args[0], out, err).pipe(Effect.provide(RemoteAccessControl.layer(options)))
  );
