/** The transport's trusted session identity passes to the Engine's Grant check once. */
import { NotGranted } from "@polaris/protocol";
import { Effect } from "effect";
import type { Actor, ActorRequest } from "../transport/actor.ts";
import { Engine } from "./Engine.ts";

export const authorizeSessionActor = (
  actor: Extract<Actor, { kind: "agentSession" }>,
  request: ActorRequest
) =>
  Effect.flatMap(Engine, (engine) =>
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
