/** `logbook_read` and `logbook_note`: a Task's Logbook through L1's service and its access rules. */
import {
  ConstellationCommand,
  type ConstellationRejected,
  type ConstellationResult,
  type LogbookPage,
  Sequence,
  TaskId,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { logbookLine } from "../../constellation/delivery/logbook.ts";
import { type McpBinding, sessionBinding } from "../binding.ts";
import {
  type BoundTool,
  type ConstellationCommands,
  errorResult,
  inputRejection,
  jsonSchema,
  type McpToolResult,
  type toolFactory,
} from "./shared.ts";

const C = ConstellationCommand.cases;

const NoteText = C.Note.fields.text;

const pageText = (page: LogbookPage) =>
  [
    `Logbook · ${page.taskId ?? "every Task"} · cursor ${page.cursor}`,
    "Attempts:",
    ...(page.attempts.length === 0
      ? ["None yet."]
      : page.attempts.map(
          (a) =>
            `${a.taskId} Attempt ${a.number} (${a.attemptId}) · ${a.cause} · ${a.state} · from #${a.sequence}`
        )),
    `Entries (${page.entries.length}):`,
    ...(page.entries.length === 0 ? ["None after since."] : page.entries.map(logbookLine)),
    `Next: pass since: ${page.cursor} to read only what follows.`,
  ].join("\n");

/** A read is not a command: its refusal goes back as is, never filled in with the graph. */
const readTool = (
  binding: McpBinding,
  commands: ConstellationCommands,
  description: string
): BoundTool => {
  const schema = Schema.Struct({
    task: Schema.optionalKey(TaskId),
    since: Schema.optionalKey(Sequence),
  });

  return {
    name: "logbook_read",
    description,
    inputSchema: jsonSchema(schema),
    annotations: { readOnlyHint: true },
    call: (input) =>
      Effect.runPromise(
        Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
          Effect.mapError(() => inputRejection("logbook_read")),
          Effect.flatMap((scope) =>
            commands.logbook.read(sessionBinding(binding), {
              constellationId: binding.constellationId,
              taskId: scope.task,
              since: scope.since,
            })
          ),
          Effect.map((page): McpToolResult => ({
            content: [{ type: "text", text: pageText(page) }],
          })),
          Effect.catchTag("ConstellationRejected", (error) => Effect.succeed(errorResult(error)))
        )
      ),
  };
};

type Submit = (
  command: ConstellationCommand
) => Effect.Effect<ConstellationResult, ConstellationRejected>;

const NOTED = {
  mutates: true,
  summary: "Note recorded on the Logbook.",
  next: "A note is a record only and reaches no worker; use message to steer one.",
} as const;

/** A worker reads its own Task's Logbook and those of the Tasks it depends on, and notes its own. */
export const workerLogbookTools = (
  binding: McpBinding,
  commands: ConstellationCommands,
  define: ReturnType<typeof toolFactory>,
  submit: Submit,
  ownTask: Effect.Effect<TaskId, ConstellationRejected>
): ReadonlyArray<BoundTool> => [
  readTool(
    binding,
    commands,
    "Read a Task's Logbook: its Attempts, questions and answers, messages, Claims, reviews and notes. task is your own Task or one it depends on; since is a cursor from an earlier read, to get only what came after."
  ),
  define(
    "logbook_note",
    "Write a note on your own Task's Logbook: a decision, a finding or a dead end the next Attempt and the workers of dependent Tasks should know. A note is a record only; the Lead is not woken by it.",
    Schema.Struct({ text: NoteText }),
    (input) =>
      Effect.flatMap(ownTask, (taskId) =>
        submit(C.Note.make({ constellationId: binding.constellationId, taskId, text: input.text }))
      ),
    NOTED
  ),
];

/** The Lead reads any Task's Logbook, or every Task's without task, and notes on any Task. */
export const leadLogbookTools = (
  binding: McpBinding,
  commands: ConstellationCommands,
  define: ReturnType<typeof toolFactory>,
  submit: Submit
): ReadonlyArray<BoundTool> => [
  readTool(
    binding,
    commands,
    "Read a Task's Logbook (its Attempts, questions and answers, messages, Claims, reviews and notes), or every Task's without task. since is a cursor from an earlier read, to get only what came after."
  ),
  define(
    "logbook_note",
    "Write a note on a Task's Logbook: a decision or context its next Attempt and the workers of dependent Tasks should read. A note is a record only; use message to steer a worker.",
    Schema.Struct({ task: TaskId, text: NoteText }),
    (input) =>
      submit(
        C.Note.make({
          constellationId: binding.constellationId,
          taskId: input.task,
          text: input.text,
        })
      ),
    NOTED
  ),
];
