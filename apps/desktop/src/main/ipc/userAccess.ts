/** A Host's enrolled Desktop Apps and their requests (ENG-927): each forwards the Daemon's RPC. */
import type { LiveSession } from "@polaris/client";
import { Effect } from "effect";
import type { RequestInput } from "../../shared/contract.ts";
import { HostDirectory, toIpcError } from "../hosts.ts";

const onHost = <A, E extends { readonly _tag: string; readonly message: string }>(
  hostKey: string,
  call: (session: LiveSession) => Effect.Effect<A, E>
) =>
  HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
    Effect.flatMap((connection) => connection.session),
    Effect.flatMap(call),
    Effect.mapError(toIpcError)
  );

export const userAccessHandlers = {
  "userAccess.allow": ({ hostKey, id }: RequestInput<"userAccess.allow">) =>
    onHost(hostKey, (s) => s.client["userAccess.allow"]({ id })),
  "userAccess.deny": ({ hostKey, id }: RequestInput<"userAccess.deny">) =>
    onHost(hostKey, (s) => s.client["userAccess.deny"]({ id })),
  "userAccess.revoke": ({ hostKey, id }: RequestInput<"userAccess.revoke">) =>
    onHost(hostKey, (s) => s.client["userAccess.revoke"]({ id })),
};
