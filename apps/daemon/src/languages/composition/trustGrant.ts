import type { HostId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { LanguageTrustGrantAuthority } from "./ports.ts";
import { denied, requestAuthority } from "./authority.ts";

/** Trust changes are explicit RPC decisions from the exact current authenticated connection. */
export const authenticatedTrustGrants = (hostId: HostId) =>
  Layer.succeed(LanguageTrustGrantAuthority)({
    authorize: (principal, scope) =>
      Effect.gen(function* () {
        const auth = yield* requestAuthority(hostId);

        if (
          auth.principal !== principal ||
          scope.hostId !== hostId ||
          !auth.supports("languages.trust")
        )
          return yield* Effect.fail(denied());
        yield* auth.check;
      }),
  });
