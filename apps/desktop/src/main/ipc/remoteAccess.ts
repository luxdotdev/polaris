/** Settings → Hosts' Remote Access switch: the Host's own `remoteAccess.*` RPCs. */
import { Effect } from "effect";
import type { RequestInput } from "../../shared/contract.ts";
import { HostDirectory, toIpcError } from "../hosts.ts";

const onHost = (
  hostKey: string,
  method: "remoteAccess.status" | "remoteAccess.enable" | "remoteAccess.disable"
) =>
  HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
    Effect.flatMap((c) => Effect.flatMap(c.session, (s) => s.client[method]())),
    Effect.mapError(toIpcError)
  );

export const remoteAccessHandlers = {
  "remoteAccess.status": ({ hostKey }: RequestInput<"remoteAccess.status">) =>
    onHost(hostKey, "remoteAccess.status"),
  "remoteAccess.enable": ({ hostKey }: RequestInput<"remoteAccess.enable">) =>
    onHost(hostKey, "remoteAccess.enable"),
  "remoteAccess.disable": ({ hostKey }: RequestInput<"remoteAccess.disable">) =>
    onHost(hostKey, "remoteAccess.disable"),
};
