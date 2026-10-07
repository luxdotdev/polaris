/** Failure copy for the language commands, chosen by the error's typed reason, never its message. */
import type * as P from "@polaris/protocol";
import { Match } from "effect";

export const languageFailure = (error: P.LanguageError, host: string) =>
  Match.value(error.reason).pipe(
    Match.when("not-connected", () => `Can't reach ${host}. Try again when it's back.`),
    Match.when("timeout", () => `No answer from ${host} in time. Try again.`),
    Match.when("unsupported-capability", () => `The daemon on ${host} can't do this yet.`),
    Match.orElse(() => (error.retryable ? "Try again." : `The daemon on ${host} refused it.`))
  );
