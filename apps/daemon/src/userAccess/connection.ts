/**
 * A token-less connection's user access, read live (ADR 0114): the transport sets it on every
 * connection, so a handler's own check refuses a caller the user gate would not admit now.
 */
import { Context } from "effect";

export class ConnectionUserAccess extends Context.Service<
  ConnectionUserAccess,
  { readonly holds: () => boolean }
>()("polaris/daemon/userAccess/Connection") {}

/** False without the annotation: a caller the transport never vouched for is not the user. */
export const holdsUserAccess = (annotations: Context.Context<never>): boolean =>
  Context.getOrUndefined(annotations, ConnectionUserAccess)?.holds() ?? false;
