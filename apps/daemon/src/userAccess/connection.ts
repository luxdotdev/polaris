/**
 * A token-less connection's user access, read live (ADR 0114): the transport sets it on every
 * connection, so a handler's own check refuses a caller the user gate would not admit now.
 */
import { Context } from "effect";

export class ConnectionUserAccess extends Context.Service<
  ConnectionUserAccess,
  {
    readonly holds: () => boolean;
    /** The user gate would refuse this connection a user-only request now. */
    readonly refused: () => boolean;
  }
>()("polaris/daemon/userAccess/Connection") {}

/** False without the annotation: a caller the transport never vouched for is not the user. */
export const holdsUserAccess = (annotations: Context.Context<never>): boolean =>
  Context.getOrUndefined(annotations, ConnectionUserAccess)?.holds() ?? false;

/**
 * Whether the caller is one the user gate refuses: a token-less connection without user access.
 * Extensions, Linked Devices and Teammates are not, their own gates decide; no annotation is.
 */
export const lacksUserAccess = (annotations: Context.Context<never>): boolean =>
  Context.getOrUndefined(annotations, ConnectionUserAccess)?.refused() ?? true;
