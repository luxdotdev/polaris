/**
 * Secret Requests (ADR 0089, ENG-605): forwards `secret.provide` to the Host. The value is checked
 * and wrapped in `Redacted` as soon as it arrives; it is never stored, logged or echoed back.
 */
import { SecretValue } from "@polaris/protocol";
import { Effect, Option, Redacted, Schema } from "effect";
import type { IpcError } from "../../shared/api.ts";
import type { RequestInput } from "../../shared/contract.ts";
import { HostDirectory, toIpcError } from "../hosts.ts";

const checkValue = Schema.decodeUnknownOption(SecretValue);

/** A value the Host would refuse; the message names the rule, never the value. */
const invalid = (message: string): IpcError => ({ code: "InvalidInput", message });

const problemOf = (value: string): string =>
  value.trim() === ""
    ? "Enter the secret"
    : /[\r\n]/.test(value.trim())
      ? "Use a single line"
      : "The secret is too long";

export const secretHandlers = {
  "secret.provide": ({ hostKey, sessionId, requestId, value }: RequestInput<"secret.provide">) =>
    Option.match(checkValue(value.trim()), {
      onNone: () => Effect.fail(invalid(problemOf(value))),
      onSome: (checked) =>
        HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
          Effect.flatMap((c) => c.session),
          Effect.flatMap((s) =>
            s.client["secret.provide"]({ sessionId, requestId, value: Redacted.make(checked) })
          ),
          Effect.as(null),
          Effect.mapError(toIpcError)
        ),
    }),
};
