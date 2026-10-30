/** Host-address streams on a Host's connection in the Client runtime, failures as SOCKS replies. */
import { HostTarget, openHostAddressStream } from "@polaris/client";
import type { HostAddressFailure } from "@polaris/protocol";
import { Effect, Match } from "effect";
import { HostDirectory } from "../hosts.ts";
import type { OpenHostAddress } from "./server.ts";
import { SocksReply } from "./socks.ts";

const failureReply = Match.type<typeof HostAddressFailure.Type>().pipe(
  Match.when("not-host-address", () => SocksReply.notAllowed),
  Match.when("refused", () => SocksReply.connectionRefused),
  Match.when("unreachable", () => SocksReply.hostUnreachable),
  Match.when("timeout", () => SocksReply.ttlExpired),
  Match.orElse(() => SocksReply.generalFailure)
);

export const openThroughHost =
  (hostKey: string): OpenHostAddress<HostDirectory> =>
  (target) =>
    HostDirectory.use((directory) => directory.connection(hostKey)).pipe(
      Effect.flatMap((connection) => connection.session),
      Effect.flatMap((session) => openHostAddressStream(session, target)),
      Effect.catchTags({
        UnknownHost: () => Effect.fail(SocksReply.hostUnreachable),
        NotConnected: () => Effect.fail(SocksReply.networkUnreachable),
        HostAddressError: (error) => Effect.fail(failureReply(error.reason)),
        Unsupported: () => Effect.fail(SocksReply.generalFailure),
        RpcClientError: () => Effect.fail(SocksReply.networkUnreachable),
      })
    );

/** The Host's loopback is this machine's: the local Host, or one on a local socket. */
export const isLocalHost = (hostKey: string) =>
  HostDirectory.use((directory) => {
    const entry = directory.entry(hostKey);

    return Effect.succeed(entry !== undefined && HostTarget.$is("Local")(entry.target));
  });
