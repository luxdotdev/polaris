/** The transport's trusted session identity passes to the Engine's Grant check once. */
import { NotGranted } from "@polaris/protocol";
import { Effect } from "effect";
import type { Actor, ActorRequest } from "../transport/actor.ts";
import { Engine } from "./Engine.ts";

export const authorizeSessionActor = (
  actor: Extract<Actor, { kind: "agentSession" }>,
  request: ActorRequest
) => {
  if (request.rpc === "traces.setSettings")
    return Effect.fail(
      new NotGranted({
        what: request.rpc,
        needed: null,
        reason: "Only the user can change trace endpoints and paths.",
      })
    );

  if (
    request.rpc === "settings.set" ||
    request.rpc === "clientSettings.set" ||
    request.rpc === "session.start"
  )
    return Effect.void;

  return Effect.flatMap(Engine, (engine) =>
    engine.authorizeSessionAction(
      actor.sessionId,
      request.command === null
        ? { rpc: request.rpc, settingKey: request.settingKey }
        : { rpc: request.rpc, command: request.command, settingKey: request.settingKey }
    )
  ).pipe(
    Effect.catchTag("NotFound", (error) =>
      Effect.fail(
        new NotGranted({
          what: request.rpc,
          needed: null,
          reason: `This agent's session is not on this Host: ${error.id}`,
        })
      )
    )
  );
};
