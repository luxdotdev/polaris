import {
  AttemptId,
  CommandId,
  ConstellationCommand,
  ConstellationFinding,
  ConstellationRejected,
  ConstellationResult,
  HostId,
  ModelId,
  SessionId,
  TaskId,
  WorkerPlacement,
  MessageTarget,
  HarnessSelection,
  type HarnessKind,
  type ReasoningEffort,
  type ConstellationId,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { McpBinding, sessionBinding, type SessionBinding } from "./binding.ts";

export interface ConstellationCommands {
  readonly command: (
    binding: SessionBinding,
    id: CommandId,
    command: ConstellationCommand
  ) => Effect.Effect<ConstellationResult, ConstellationRejected>;
  readonly status: (
    binding: SessionBinding,
    id: ConstellationId,
    json: boolean
  ) => Effect.Effect<ConstellationResult, ConstellationRejected>;
  /** Resolve friendly names against the caller's Constellation and Host catalog. */
  readonly resolve: (
    binding: SessionBinding,
    id: ConstellationId,
    kind: "attempt" | "session" | "host" | "model",
    name: string
  ) => Effect.Effect<string, ConstellationRejected>;
}

export interface McpToolResult {
  readonly content: Array<{ type: "text"; text: string }>;
  readonly isError?: boolean;
}

export interface BoundTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ReturnType<typeof Schema.toJsonSchemaDocument>["schema"];
  readonly call: (input: typeof Schema.Json.Type) => Promise<McpToolResult>;
}

const rejection = (code: string, message: string, fix: string) =>
  new ConstellationRejected({
    findings: [new ConstellationFinding({ code, message, fix })],
    graph: null,
    revision: 0,
  });

const resultText = (result: ConstellationResult, json: boolean): McpToolResult => ({
  content: [
    {
      type: "text",
      text: `${result.summary}\nRevision: ${result.revision}\n${json ? `${JSON.stringify({ constellation: result.constellation, projections: result.projections })}\n` : ""}Next: ${result.next}`,
    },
  ],
});

export const errorResult = (error: ConstellationRejected): McpToolResult => ({
  isError: true,
  content: [
    {
      type: "text",
      text: JSON.stringify({
        findings: error.findings,
        graph: error.graph,
        revision: error.revision,
      }),
    },
  ],
});

const jsonSchema = (schema: Schema.Constraint) => {
  const document = Schema.toJsonSchemaDocument(schema);

  return { ...document.schema, $defs: document.definitions };
};

const define = <S extends Schema.Decoder<unknown>>(
  name: string,
  description: string,
  schema: S,
  execute: (input: S["Type"]) => Effect.Effect<ConstellationResult, ConstellationRejected>,
  json: (input: S["Type"]) => boolean = () => false
): BoundTool => ({
  name,
  description,
  inputSchema: jsonSchema(schema),
  call: (input) =>
    Effect.runPromise(
      Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() =>
          rejection(
            "E-INPUT",
            `Invalid input for ${name}`,
            "Use the fields in this tool's input schema."
          )
        ),
        Effect.flatMap((decoded) =>
          execute(decoded).pipe(Effect.map((result) => resultText(result, json(decoded))))
        ),
        Effect.catchTag("ConstellationRejected", (error) => Effect.succeed(errorResult(error)))
      )
    ),
});

interface SelectionFields {
  harness?: HarnessKind;
  model?: ModelId;
  effort?: ReasoningEffort;
}

const resolvedSelection = (selection: HarnessSelection | null, model: ModelId | undefined) => {
  if (selection === null) return null;
  const fields: SelectionFields = {};

  if (selection.harness !== undefined) fields.harness = selection.harness;

  if (model !== undefined) fields.model = model;

  if (selection.effort !== undefined) fields.effort = selection.effort;

  return new HarnessSelection(fields);
};

const C = ConstellationCommand.cases;

const FriendlyWorker = Schema.Struct({
  host: Schema.optionalKey(Schema.NonEmptyString),
  session: Schema.optionalKey(Schema.NonEmptyString),
  selection: WorkerPlacement.cases.New.fields.selection,
  base: WorkerPlacement.cases.New.fields.base,
  worktree: WorkerPlacement.cases.New.fields.worktree,
  branch: WorkerPlacement.cases.New.fields.branch,
});

/** Role is bound at attachment time; E authorizes the current role again under its store lock. */
export const constellationTools = (
  binding: McpBinding,
  commands: ConstellationCommands
): ReadonlyArray<BoundTool> => {
  const caller = sessionBinding(binding);

  const resolve = (kind: "attempt" | "session" | "host" | "model", name: string) =>
    commands.resolve(caller, binding.constellationId, kind, name);

  const submit = (command: ConstellationCommand) =>
    commands.command(caller, CommandId.make(crypto.randomUUID()), command);

  const worker = Effect.fnUntraced(function* (input: typeof FriendlyWorker.Type) {
    if (input.session !== undefined)
      return WorkerPlacement.cases.Existing.make({
        sessionId: SessionId.make(yield* resolve("session", input.session)),
      });

    if (input.host === undefined)
      return yield* rejection(
        "E-HOST",
        "A new worker needs a Host",
        "Set worker.host or name an existing worker.session."
      );
    const selection = input.selection;

    const model =
      selection?.model === undefined
        ? undefined
        : ModelId.make(yield* resolve("model", selection.model));

    return WorkerPlacement.cases.New.make({
      hostId: HostId.make(yield* resolve("host", input.host)),
      selection: resolvedSelection(selection, model),
      base: input.base,
      worktree: input.worktree,
      branch: input.branch,
    });
  });

  const status = define(
    "status",
    "Read the graph, Claims, questions and ready Tasks. Do not poll; updates arrive as Lead Turns.",
    Schema.Struct({ json: Schema.optionalKey(Schema.Boolean) }),
    (input) => commands.status(caller, binding.constellationId, input.json ?? false),
    (input) => input.json ?? false
  );

  return McpBinding.match(binding, {
    Lead: () => [
      define(
        "plan",
        "Declare, edit or cancel Tasks with short ids. Edit and cancel require the current Task revision.",
        Schema.Struct({
          start: Schema.optionalKey(
            Schema.Struct({
              name: Schema.NonEmptyString,
              workspaceId: C.Plan.fields.start.schema.fields.workspaceId,
              settings: C.Plan.fields.start.schema.fields.settings,
            })
          ),
          operations: C.Plan.fields.operations,
          resources: C.Plan.fields.resources,
        }),
        (input) => {
          const fields = {
            operations: input.operations,
            resources: input.resources,
            constellationId: binding.constellationId,
          };

          if (input.start === undefined) return submit(C.Plan.make(fields));

          return submit(
            C.Plan.make({ ...fields, start: { ...input.start, leadSessionId: binding.sessionId } })
          );
        }
      ),
      define(
        "dispatch",
        "Start named Tasks on a Host, or in an existing worker Agent Session.",
        Schema.Struct({
          tasks: Schema.Array(Schema.Struct({ taskId: TaskId, worker: FriendlyWorker })),
        }),
        Effect.fnUntraced(function* (input) {
          const tasks = yield* Effect.forEach(
            input.tasks,
            Effect.fnUntraced(function* (task) {
              return { taskId: task.taskId, worker: yield* worker(task.worker) };
            })
          );

          return yield* submit(
            C.Dispatch.make({ constellationId: binding.constellationId, tasks })
          );
        })
      ),
      define(
        "review",
        "Accept a claimed head with receipts, send it back, or stop the latest Attempt. Revision is required.",
        Schema.Struct({
          task: Schema.NonEmptyString,
          revision: C.Review.fields.revision,
          action: C.Review.fields.action,
        }),
        Effect.fnUntraced(function* (input) {
          return yield* submit(
            C.Review.make({
              constellationId: binding.constellationId,
              attemptId: AttemptId.make(yield* resolve("attempt", input.task)),
              revision: input.revision,
              action: input.action,
            })
          );
        })
      ),
      define(
        "answer",
        "Answer a question or accept or decline a Task proposal.",
        Schema.Struct({ action: C.Answer.fields.action }),
        (input) => submit(C.Answer.make({ ...input, constellationId: binding.constellationId }))
      ),
      define(
        "message",
        "Steer a named worker, or send a note to all workers.",
        Schema.Struct({ to: Schema.NonEmptyString, text: Schema.NonEmptyString }),
        Effect.fnUntraced(function* (input) {
          const target =
            input.to === "all"
              ? MessageTarget.cases.All.make({})
              : MessageTarget.cases.Worker.make({
                  attemptId: AttemptId.make(yield* resolve("attempt", input.to)),
                });

          return yield* submit(
            C.Message.make({ constellationId: binding.constellationId, target, text: input.text })
          );
        })
      ),
      status,
      define(
        "set_state",
        "Pause, resume, complete, archive or hand over the Constellation.",
        Schema.Struct({ action: C.SetState.fields.action }),
        (input) => submit(C.SetState.make({ ...input, constellationId: binding.constellationId }))
      ),
    ],
    Worker: (bound) => [
      define(
        "progress",
        "Record a progress note and optional completed/total count in the UI.",
        Schema.Struct({
          note: C.WorkerProgress.fields.note,
          completed: C.WorkerProgress.fields.completed,
          total: C.WorkerProgress.fields.total,
        }),
        (input) =>
          submit(
            C.WorkerProgress.make({
              ...input,
              constellationId: bound.constellationId,
              attemptId: bound.attemptId,
            })
          )
      ),
      define(
        "ask",
        "Ask the Lead or user a question. Only the user grants approvals.",
        Schema.Struct({ question: C.WorkerAsk.fields.question }),
        (input) =>
          submit(
            C.WorkerAsk.make({
              ...input,
              constellationId: bound.constellationId,
              attemptId: bound.attemptId,
            })
          )
      ),
      define(
        "claim",
        "Submit branch, head, commits, check receipts, unfinished work, follow-ups, questions, Area exceptions, decisions and summary.",
        Schema.Struct({ claim: C.WorkerClaim.fields.claim }),
        (input) =>
          submit(
            C.WorkerClaim.make({
              ...input,
              constellationId: bound.constellationId,
              attemptId: bound.attemptId,
            })
          )
      ),
      define(
        "propose",
        "Propose a new Task for the Lead to accept or decline.",
        Schema.Struct({ task: C.WorkerPropose.fields.task }),
        (input) =>
          submit(
            C.WorkerPropose.make({
              ...input,
              constellationId: bound.constellationId,
              attemptId: bound.attemptId,
            })
          )
      ),
      define(
        "message",
        "Message a peer in this Constellation by its short Task id.",
        Schema.Struct({ to: TaskId, text: Schema.NonEmptyString }),
        (input) =>
          submit(
            C.WorkerMessage.make({
              ...input,
              constellationId: bound.constellationId,
              attemptId: bound.attemptId,
            })
          )
      ),
      status,
    ],
  });
};

export const unavailableCommands: ConstellationCommands = {
  command: () =>
    Effect.fail(
      rejection(
        "E-NOT-READY",
        "Constellation commands are not connected",
        "Connect the owning Daemon's Constellations service."
      )
    ),
  status: () =>
    Effect.fail(
      rejection(
        "E-NOT-READY",
        "Constellation status is not connected",
        "Connect the owning Daemon's Constellations service."
      )
    ),
  resolve: () =>
    Effect.fail(
      rejection(
        "E-NOT-READY",
        "Name resolution is not connected",
        "Connect the Host and Constellation catalogs."
      )
    ),
};
