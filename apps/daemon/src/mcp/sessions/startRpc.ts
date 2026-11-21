import { tokenlessClient } from "../../transport/userAccess.ts";
import { admissionOf } from "../../extensions/admission.ts";
import { holdsUserAccess } from "../../userAccess/index.ts";
/** Resolve starts at the Daemon; cwd and flags never select the caller's authority. */
import {
  CommandId,
  decideUserAccess,
  SessionStartRpcs,
  SessionStartUsage,
  type SessionStartInput,
} from "@polaris/protocol";
import { Effect, Option } from "effect";
import { realpathSync } from "node:fs";
import { relative, isAbsolute, resolve } from "node:path";
import { Engine } from "../../engine/Engine.ts";
import { dispatchForClient } from "../../engine/rpc.ts";
import { EventStore } from "../../store/EventStore.ts";
import { actorOf } from "../../transport/actor.ts";
import { ConnectionBlobs } from "../../transport/rpcs.ts";
import { Availability } from "../../harness/availability/Availability.ts";
import { sessionStartCommand, type SessionDefaultsFor } from "./control.ts";
import { hostSessionDefaultsAt } from "./defaults.ts";

/** The real path when it exists: a CLI's cwd is resolved (macOS /tmp is /private/tmp). */
const canonical = (path: string) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

export const deepestWorkspace = <T extends { path: string }>(
  workspaces: ReadonlyArray<T>,
  cwd: string
): T | undefined =>
  workspaces
    .filter((workspace) => {
      const path = relative(canonical(workspace.path), canonical(cwd));

      return (
        path === "" ||
        (path !== ".." && !path.startsWith("../") && !path.startsWith("..\\") && !isAbsolute(path))
      );
    })
    .sort((a, b) => b.path.length - a.path.length)[0];

export const sessionStartRpcHandlers = (defaults: SessionDefaultsFor = hostSessionDefaultsAt()) =>
  SessionStartRpcs.middleware(ConnectionBlobs).toLayer(
    Effect.gen(function* () {
      const engine = yield* Engine;
      const store = yield* EventStore;
      const availability = yield* Effect.serviceOption(Availability);

      return {
        "session.start": (input: typeof SessionStartInput.Type, { client }) =>
          Effect.gen(function* () {
            const actor = actorOf(client);
            const model = yield* store.model;

            const own =
              actor.kind === "agentSession"
                ? model.sessions.get(actor.sessionId)?.session
                : undefined;

            const workspaceId =
              input.workspaceId ??
              own?.workspaceId ??
              (input.cwd === undefined
                ? undefined
                : deepestWorkspace([...model.workspaces.values()], input.cwd)?.id);

            if (workspaceId === undefined)
              return yield* new SessionStartUsage({
                message: "No registered Workspace contains this directory. Supply --workspace-id.",
              });
            const harness = input.harness ?? own?.harness;

            if (harness === undefined) {
              const installed = Option.isSome(availability)
                ? (yield* availability.value.get(false)).harnesses
                    .filter(
                      (entry) =>
                        entry.status === "ready" ||
                        entry.status === "needs-sign-in" ||
                        entry.status === "outdated"
                    )
                    .map((entry) => entry.harness)
                : [];

              return yield* new SessionStartUsage({
                message: `Choose --harness. Installed Harnesses: ${installed.join(", ") || "none"}.`,
              });
            }

            if (
              actor.kind === "user" &&
              tokenlessClient(client, { tokenRequired: () => admissionOf(client).tokenRequired })
            ) {
              const refusal = decideUserAccess(
                "dispatch",
                "StartSession",
                holdsUserAccess(client.annotations)
              );

              if (refusal !== null) return yield* refusal;
            }

            const command = sessionStartCommand({ workspaceId, harness }, input, defaults);

            const ack = yield* dispatchForClient(engine, client, {
              commandId: CommandId.make(crypto.randomUUID()),
              command,
            });

            return { sequence: ack.sequence, sessionId: command.sessionId };
          }),
      };
    })
  );

export const SessionStartRpcHandlers = sessionStartRpcHandlers();
