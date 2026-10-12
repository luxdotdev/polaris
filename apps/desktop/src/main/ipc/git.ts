/** The `git.*` requests in `gitContract.ts`: each forwards the Daemon RPC of the same name. */
import type { LiveSession } from "@polaris/client";
import { Effect } from "effect";
import type { GitRequestInputs } from "../../shared/gitContract.ts";
import { HostDirectory, toIpcError } from "../hosts.ts";
import type { Handler } from "./requests.ts";

type Failure = { readonly _tag: string; readonly message: string };

const onLive = <A, E extends Failure>(
  hostKey: string,
  use: (session: LiveSession) => Effect.Effect<A, E>
) =>
  HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
    Effect.flatMap((c) => Effect.flatMap(c.session, use)),
    Effect.mapError(toIpcError)
  );

type GitHandlers = { readonly [M in keyof typeof GitRequestInputs]: Handler<M> };

export const gitHandlers: GitHandlers = {
  "git.status": ({ hostKey, ...payload }) =>
    onLive(hostKey, (s) => s.client["git.status"](payload)),
};
