/**
 * The Remote Access URL Extensions away from this Host connect to (CONTEXT.md:
 * Remote Access), for the pairing string. Task C's Tailscale Layer replaces
 * `RemoteAccessNone`, which reports it off.
 */
import { Context, Effect, Layer, Option } from "effect";

export class RemoteAccess extends Context.Service<
  RemoteAccess,
  {
    /** `wss://<host>.<tailnet>.ts.net/polaris/rpc` while Remote Access is on; none otherwise. */
    readonly url: Effect.Effect<Option.Option<string>>;
  }
>()("polaris/daemon/extensions/RemoteAccess") {}

export const RemoteAccessNone = Layer.succeed(RemoteAccess, { url: Effect.succeed(Option.none()) });
