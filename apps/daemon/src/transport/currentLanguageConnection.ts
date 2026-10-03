import type { Capability, LanguageConnectionIdentity } from "@polaris/protocol";
import { Context } from "effect";

/** Request-local lookup over the exact live RPC connection, including after awaited work. */
export class CurrentLanguageConnection extends Context.Service<
  CurrentLanguageConnection,
  {
    current: () => LanguageConnectionIdentity | null;
    supports?: (capability: Capability) => boolean;
  }
>()("polaris/transport/CurrentLanguageConnection") {}
