/** A Daemon in a throwaway root for the user access suites, and Clients over its socket. */
import { join } from "node:path";
import { connectRpcWith, socketTransport } from "@polaris/client";
import {
  ApprovalDecision,
  Command,
  CommandId,
  CommandRejected,
  ExtensionDaemonRpcs,
  RequestId,
  SessionId,
} from "@polaris/protocol";
import { Cause, Effect, Exit, Layer, Option, Redacted, type Scope, Stream } from "effect";
import { deletePath } from "../files/write.ts";
import { scopedTempDir } from "../platform/tempDir.testing.ts";
import { ServerRpcs } from "./rpcs.ts";
import { startServer } from "./server.ts";

const temporary = scopedTempDir("pl-ua-", { short: true });

const REACHED = "reached the handler";

const handlers = Layer.mergeAll(
  ServerRpcs.toLayerHandler("dispatch", ({ commandId }) =>
    Effect.fail(new CommandRejected({ commandId, reason: REACHED }))
  ),
  ServerRpcs.toLayerHandler("secret.provide", () => Effect.void),
  // The real deletion, so a refusal is what keeps the file.
  ServerRpcs.toLayerHandler("files.delete", ({ path, permanent }) =>
    Effect.orDie(Effect.promise(() => deletePath(path, permanent)))
  ),
  // A user-only stream that stays open until something ends it.
  ServerRpcs.toLayerHandler("computerUse.preview.watch", () => Stream.never)
);

export const DESKTOP_KEY = "a".repeat(64);

export const AGENT_KEY = "b".repeat(64);

export const identity = {
  clientName: "test",
  clientVersion: "0",
  deviceLabel: "Test MacBook",
  capabilities: [],
};

export const hello = (userKey?: string, deviceLabel = identity.deviceLabel) =>
  userKey === undefined
    ? { ...identity, deviceLabel }
    : { ...identity, deviceLabel, userKey: Redacted.make(userKey) };

export const sessionId = SessionId.make("s1");

const requestId = RequestId.make("r1");

export const command = (value: Command) => ({
  commandId: CommandId.make(crypto.randomUUID()),
  command: value,
});

export const approve = command(
  Command.cases.RespondToApproval.make({
    sessionId,
    requestId,
    decision: ApprovalDecision.cases.Allow.make({ remember: false }),
  })
);

export const rename = command(Command.cases.RenameSession.make({ sessionId, title: "t" }));

export const secret = { sessionId, requestId, value: Redacted.make("hunter2") };

/** The refusal's tag and what it named, or whether the request reached its handler. */
export const outcome = <A, E extends { readonly _tag: string }>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.exit(effect), (exit) => {
    if (Exit.isSuccess(exit)) return "ok";
    const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));

    if (error === undefined) return "defect";

    if (error instanceof CommandRejected && error.reason === REACHED) return "reached";

    return "what" in error ? `${error._tag}:${String(error.what)}` : error._tag;
  });

/** The SDK's group, which decodes both gates' refusals. */
export const connectAt = (socketPath: string) =>
  Effect.flatMap(socketTransport(socketPath), (transport) =>
    connectRpcWith(ExtensionDaemonRpcs, transport)
  );

export type Connect = () => ReturnType<typeof connectAt>;

/** A server with this module's handlers in a throwaway root, and how to connect to it. */
export const withServer = <A, E>(
  body: (connect: Connect, root: string, socketPath: string) => Effect.Effect<A, E, Scope.Scope>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporary;

      const server = yield* startServer({
        root,
        socketPath: join(root, "d.sock"),
        lockPath: join(root, "d.lock"),
        handlers,
      });

      return yield* body(() => connectAt(server.socketPath), root, server.socketPath);
    })
  );
