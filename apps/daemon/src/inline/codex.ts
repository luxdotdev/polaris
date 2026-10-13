import { InlineError, type InlinePatch } from "@polaris/protocol";
import { Effect, Option, Predicate, Queue, Schema, type Scope } from "effect";
import { HarnessError } from "../harness/HarnessDriver.ts";
import { connectStdio, type RpcConnection, type Incoming } from "../harness/codex/RpcConnection.ts";
import type { InlineBackend, Progress } from "./backend.ts";
import type { StructuredJob } from "./structured.ts";
import { decodePatchText, harnessPrompt, instructions, patchJsonSchema } from "./patch.ts";

const Config = Schema.Struct({
  config: Schema.Struct({
    mcp_servers: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
});

const Thread = Schema.Struct({
  thread: Schema.Struct({ id: Schema.String }),
  sandbox: Schema.Struct({
    type: Schema.Literal("readOnly"),
    networkAccess: Schema.Literal(false),
  }),
});

const Turn = Schema.Struct({ turn: Schema.Struct({ id: Schema.String }) });

const Delta = Schema.Struct({ threadId: Schema.String, delta: Schema.String });

const Item = Schema.Struct({
  threadId: Schema.String,
  item: Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
});

const Completed = Schema.Struct({
  threadId: Schema.String,
  turn: Schema.Struct({
    id: Schema.String,
    status: Schema.String,
    error: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: Schema.String }))),
  }),
});

const notification = Effect.fn("inline.codex.notification")(function* (
  incoming: Incoming,
  threadId: string,
  turnId: string
): Effect.fn.Return<{ delta?: string; finalText?: string; completed?: boolean }, HarnessError> {
  switch (incoming.method) {
    case "item/agentMessage/delta": {
      const value = Schema.decodeUnknownOption(Delta)(incoming.params);

      return Option.isSome(value) && value.value.threadId === threadId
        ? { delta: value.value.delta }
        : {};
    }

    case "item/completed": {
      const value = Schema.decodeUnknownOption(Item)(incoming.params);

      return Option.isSome(value) &&
        value.value.threadId === threadId &&
        value.value.item.type === "agentMessage"
        ? { finalText: value.value.item.text ?? "" }
        : {};
    }

    case "turn/completed": {
      const value = yield* Schema.decodeUnknownEffect(Completed)(incoming.params).pipe(
        Effect.mapError(
          () => new HarnessError({ harness: "codex", message: "Invalid Codex completion" })
        )
      );

      if (value.threadId !== threadId || value.turn.id !== turnId) return {};

      if (value.turn.status !== "completed")
        return yield* new HarnessError({
          harness: "codex",
          message: value.turn.error?.message ?? "Codex did not complete the request",
        });

      return { completed: true };
    }

    default:
      return {};
  }
});

const receive = Effect.fn("inline.codex.receive")(function* (
  conn: RpcConnection,
  threadId: string,
  turnId: string,
  progress: Progress
) {
  let finalText: string | null = null;

  while (true) {
    const incoming = yield* Queue.take(conn.incoming).pipe(
      Effect.mapError(
        () =>
          new HarnessError({
            harness: "codex",
            message: "Codex disconnected before answering",
          })
      )
    );

    if (Predicate.isTagged(incoming, "Request")) {
      yield* conn.respondError(
        incoming.id,
        -32600,
        "One-shot requests do not allow tool requests or approvals"
      );
      continue;
    }

    const event = yield* notification(incoming, threadId, turnId);

    if (event.delta !== undefined) yield* progress(event.delta);

    if (event.finalText !== undefined) finalText = event.finalText;

    if (!event.completed) continue;

    if (finalText !== null) return finalText;

    return yield* new HarnessError({
      harness: "codex",
      message: "Codex completed without an answer",
    });
  }
});

/** A private app-server process; closing the request scope kills it and its ephemeral thread. */
export const codexStructured = Effect.fn("harness.codex.structured")(function* (
  connect: Effect.Effect<RpcConnection, HarnessError, Scope.Scope>,
  job: StructuredJob,
  cwd: string,
  progress: Progress
): Effect.fn.Return<string, HarnessError, Scope.Scope> {
  const conn = yield* connect;
  yield* conn.request("initialize", {
    clientInfo: { name: "polaris", title: "Polaris", version: "0.0.0" },
    capabilities: { experimentalApi: false, requestAttestation: false },
  });

  yield* conn.notify("initialized");

  const configured = yield* Schema.decodeUnknownEffect(Config)(
    yield* conn.request("config/read", { includeLayers: false, cwd })
  ).pipe(
    Effect.mapError(
      () =>
        new HarnessError({
          harness: "codex",
          message: "Cannot verify Codex tool configuration",
        })
    )
  );

  const config = {
    "features.shell_tool": false,
    "features.unified_exec": false,
    "features.plugins": false,
    "features.apps": false,
    "features.multi_agent_v2": false,
    "features.request_permissions_tool": false,
    "features.view_image": false,
    "features.standalone_web_search": false,
    "cloud.skills.enabled": false,
    "skills.include_instructions": false,
    "features.apply_patch_freeform": false,
    "features.multi_agent": false,
    "features.collab": false,
    "features.hooks": false,
    web_search: "disabled",
    notify: [],
    mcp_servers: Object.fromEntries(
      Object.keys(configured.config.mcp_servers ?? {}).map((name) => [name, { enabled: false }])
    ),
  };

  const thread = yield* Schema.decodeUnknownEffect(Thread)(
    yield* conn.request("thread/start", {
      cwd,
      ephemeral: true,
      model: job.model,
      sandbox: "read-only",
      approvalPolicy: "never",
      baseInstructions: job.instructions,
      developerInstructions: job.instructions,
      config,
    })
  ).pipe(
    Effect.mapError(
      () => new HarnessError({ harness: "codex", message: "Invalid Codex thread response" })
    )
  );

  let turnId: string | null = null;

  yield* Effect.addFinalizer(() =>
    turnId === null
      ? Effect.void
      : conn
          .request("turn/interrupt", { threadId: thread.thread.id, turnId })
          .pipe(Effect.timeout("2 seconds"), Effect.ignore)
  );

  const turn = yield* Schema.decodeUnknownEffect(Turn)(
    yield* conn.request("turn/start", {
      threadId: thread.thread.id,
      model: job.model,
      effort: job.effort,
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      approvalPolicy: "never",
      input: [{ type: "text", text: job.prompt, text_elements: [] }],
      outputSchema: job.schema,
    })
  ).pipe(
    Effect.mapError(
      () => new HarnessError({ harness: "codex", message: "Invalid Codex turn response" })
    )
  );

  turnId = turn.turn.id;

  const text = yield* receive(conn, thread.thread.id, turnId, progress);

  turnId = null;

  return text;
});

export const codexInline = (
  binary: string,
  connect: Effect.Effect<RpcConnection, HarnessError, Scope.Scope> = connectStdio(binary)
): InlineBackend =>
  Effect.fn("inline.codex")(function* (request, cwd, progress): Effect.fn.Return<
    InlinePatch,
    InlineError,
    Scope.Scope
  > {
    const job = {
      instructions,
      prompt: harnessPrompt(request),
      schema: patchJsonSchema,
      model: request.model,
      effort: request.effort,
      read: true,
    };

    const text = yield* codexStructured(connect, job, cwd, progress).pipe(
      Effect.mapError(
        (error) =>
          new InlineError({
            reason: "harness-failed",
            message: `Codex could not complete the inline proposal: ${error.message}`,
          })
      )
    );

    return yield* decodePatchText(text);
  });
