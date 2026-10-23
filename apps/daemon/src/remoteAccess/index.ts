/**
 * Remote Access (CONTEXT.md, ADR 0076): the gateway served at
 * `https://<machine>.<tailnet>.ts.net/polaris` by `tailscale serve`. Tailscale keeps the state
 * (`serve --bg` persists), so status is always read back from it.
 */
import { RemoteAccessError, type RemoteAccessReason, RemoteAccessStatus } from "@polaris/protocol";
import { Context, Effect, Layer, Match } from "effect";
import { GATEWAY_PREFIX, GATEWAY_RPC_PATH, runningGateway, serveTarget } from "./gateway.ts";
import {
  findTailscale,
  readServedProxy,
  readStatus,
  serveOff,
  serveOn,
  type TailscaleCli,
  type TailscaleCommandError,
  type TailscaleParseError,
} from "./tailscale.ts";

/** What the user reads for each reason: Polaris's words, never Tailscale's output. */
export const REASON_MESSAGES: Record<RemoteAccessReason, string> = {
  "not-installed": "Tailscale isn't installed on this host.",
  "not-running": "Tailscale isn't running on this host.",
  "not-logged-in": "Tailscale isn't logged in on this host.",
  "https-disabled": "HTTPS certificates aren't enabled for this tailnet.",
  "needs-operator":
    "Tailscale needs `sudo tailscale set --operator=$USER` once before Polaris can serve.",
  "gateway-not-running": "The gateway isn't running on this host.",
  failed: "Tailscale didn't answer as expected. Try again.",
};

const reasonOfBackend = (state: string | null): RemoteAccessReason | null =>
  Match.value(state).pipe(
    Match.when("Running", () => null),
    Match.when(null, () => null),
    Match.whenOr("NeedsLogin", "NeedsMachineAuth", "NoState", () => "not-logged-in" as const),
    Match.orElse(() => "not-running" as const)
  );

/** Why Tailscale refused, from a failed command. */
export const reasonOfError = (
  error: TailscaleCommandError | TailscaleParseError,
  os: string = process.platform
): RemoteAccessReason =>
  Match.value(error).pipe(
    Match.tag("TailscaleExitError", ({ diagnostic }) =>
      Match.value(diagnostic).pipe(
        Match.when("not-logged-in", () => "not-logged-in" as const),
        Match.when("not-running", () => "not-running" as const),
        Match.when("https-disabled", () => "https-disabled" as const),
        Match.when("permission-denied", () =>
          os === "linux" ? ("needs-operator" as const) : ("failed" as const)
        ),
        Match.orElse(() => "failed" as const)
      )
    ),
    Match.orElse(() => "failed" as const)
  );

/** Why Remote Access can't be on; `host` once Tailscale named one. */
interface NotReady {
  readonly reason: RemoteAccessReason;
  readonly host: string | null;
}

export interface RemoteAccessOptions {
  /** The Polaris home holding `gateway.json`. */
  readonly root: string;
  /** Overrides for tests. */
  readonly findCli?: () => TailscaleCli | null;
  readonly os?: string;
}

export const makeRemoteAccess = (options: RemoteAccessOptions) => {
  const os = options.os ?? process.platform;
  const findCli = options.findCli ?? (() => findTailscale());

  const notReady = (reason: RemoteAccessReason, host: string | null = null): NotReady => ({
    reason,
    host,
  });

  const fromCommand = (error: TailscaleCommandError | TailscaleParseError) =>
    notReady(reasonOfError(error, os));

  /** The CLI and the MagicDNS name of a Tailscale that can serve HTTPS. */
  const ready = Effect.gen(function* () {
    const cli = findCli();

    if (cli === null) return yield* Effect.fail(notReady("not-installed"));
    const status = yield* readStatus(cli).pipe(Effect.mapError(fromCommand));
    const backend = reasonOfBackend(status.backendState);
    const host = status.magicDnsName;

    if (backend !== null) return yield* Effect.fail(notReady(backend, host));

    if (host === null || status.httpsEnabled === false)
      return yield* Effect.fail(notReady("https-disabled", host));

    return { cli, host };
  });

  /** The proven gateway's port, or why there is none to serve. */
  const gateway = (host: string) =>
    Effect.flatMap(runningGateway(options.root), (record) =>
      record === null
        ? Effect.fail(notReady("gateway-not-running", host))
        : Effect.succeed(record.port)
    );

  const statusOf = (cli: TailscaleCli, host: string, port: number) =>
    readServedProxy(cli, host, GATEWAY_PREFIX).pipe(
      Effect.mapError(fromCommand),
      Effect.map((proxy) => {
        // A path left proxying to an old gateway port is off: enabling replaces it.
        const on = proxy === serveTarget(port);

        return new RemoteAccessStatus({
          state: on ? "on" : "off",
          url: on ? `wss://${host}${GATEWAY_RPC_PATH}` : null,
          hostName: host,
          reason: null,
        });
      })
    );

  // Without a gateway, Tailscale is ready but there is nothing to serve: off, saying why.
  const unavailable = ({ reason, host }: NotReady) =>
    new RemoteAccessStatus({
      state: reason === "gateway-not-running" ? "off" : "unavailable",
      url: null,
      hostName: host,
      reason,
    });

  const fail = ({ reason }: NotReady) =>
    new RemoteAccessError({ reason, message: REASON_MESSAGES[reason] });

  const status: Effect.Effect<RemoteAccessStatus> = ready.pipe(
    Effect.flatMap(({ cli, host }) =>
      Effect.flatMap(gateway(host), (port) => statusOf(cli, host, port))
    ),
    Effect.catch((why) => Effect.succeed(unavailable(why)))
  );

  const enable = ready.pipe(
    Effect.flatMap(({ cli, host }) =>
      Effect.flatMap(gateway(host), (port) =>
        serveOn(cli, GATEWAY_PREFIX, serveTarget(port)).pipe(
          Effect.mapError(fromCommand),
          Effect.andThen(statusOf(cli, host, port))
        )
      )
    ),
    Effect.mapError(fail)
  );

  const disable = Effect.gen(function* () {
    const cli = findCli();

    // Nothing is served without Tailscale.
    if (cli !== null) yield* serveOff(cli, GATEWAY_PREFIX).pipe(Effect.mapError(fromCommand));

    return yield* status;
  }).pipe(Effect.mapError(fail));

  return { status, enable, disable };
};

export class RemoteAccessControl extends Context.Service<
  RemoteAccessControl,
  {
    readonly status: Effect.Effect<RemoteAccessStatus>;
    readonly enable: Effect.Effect<RemoteAccessStatus, RemoteAccessError>;
    readonly disable: Effect.Effect<RemoteAccessStatus, RemoteAccessError>;
  }
>()("polaris/daemon/remoteAccess/RemoteAccessControl") {
  static layer(options: RemoteAccessOptions) {
    return Layer.succeed(RemoteAccessControl)(makeRemoteAccess(options));
  }
}
