/**
 * A Polaris account's sign-in through ASWebAuthenticationSession (`modules/polaris-auth-session`),
 * which returns the Account Server's `polaris://accounts/callback` redirect. Null in builds
 * before the module, where only the device code works.
 */
import { AccountsError, type Authorizer } from "@polaris/client/accounts";
import { Effect } from "effect";
import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class PolarisAuthSessionModule extends NativeModule {
  start(url: string, callbackScheme: string): Promise<string | null>;
}

const native = requireOptionalNativeModule<PolarisAuthSessionModule>("PolarisAuthSession");

export const REDIRECT_URI = "polaris://accounts/callback";

const failed = (message: string) => new AccountsError({ reason: "sign-in-failed", message });

/** Null when this build has no auth session. */
export const authSession: Effect.Effect<Authorizer> | null =
  native === null
    ? null
    : Effect.succeed({
        redirectUri: REDIRECT_URI,
        open: (url) =>
          Effect.tryPromise({
            try: () => native.start(url, "polaris"),
            catch: (cause) => failed(cause instanceof Error ? cause.message : String(cause)),
          }).pipe(
            Effect.flatMap((returned) =>
              returned === null ? Effect.fail(failed("cancelled")) : Effect.succeed(returned)
            )
          ),
      });
