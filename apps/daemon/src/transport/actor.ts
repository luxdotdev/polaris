import { accessFor, type Command, type Grant, NotGranted, type SessionId } from "@polaris/protocol";
import { Context, Effect } from "effect";
import type { Rpc } from "effect/rpc";

export type Actor =
  | { readonly kind: "user" }
  | { readonly kind: "agentSession"; readonly sessionId: SessionId }
  | { readonly kind: "agentUnattributed"; readonly harnessServer: string };

export const userActor: Actor = { kind: "user" };

export interface ActorRequest {
  readonly rpc: string;
  readonly command: Command | null;
  readonly settingKey?: string | undefined;
}

/** Set only from kernel peer credentials, never from hello, flags or environment variables. */
export class ConnectionActor extends Context.Service<ConnectionActor, Actor>()(
  "polaris/daemon/transport/ConnectionActor"
) {}

export const actorOf = (client: Rpc.ServerClient): Actor =>
  Context.getOrUndefined(client.annotations, ConnectionActor) ?? userActor;

export const unattributedReason =
  "This agent's session can't be identified (Codex/OpenCode share one server); run it from the session's tools instead. See ENG-1027.";

/** B1 supplies the live session Grant and approval path; until then only its initial Grant applies. */
export const authorize = (
  actor: Actor,
  grant: Grant,
  request: { readonly rpc: string; readonly command: string | null }
): Effect.Effect<void, NotGranted> => {
  if (actor.kind === "user") return Effect.void;

  const { what, access } = accessFor(request.rpc, request.command);

  const allowed =
    actor.kind === "agentUnattributed"
      ? access === "read"
      : access !== "client" && access !== "open" && grant.includes(access);

  if (request.rpc === "hello" || allowed) return Effect.void;

  const refusal = {
    what,
    needed: access === "client" || access === "open" ? null : access,
  };

  return Effect.fail(
    actor.kind === "agentUnattributed"
      ? new NotGranted({ ...refusal, reason: unattributedReason })
      : new NotGranted(refusal)
  );
};
