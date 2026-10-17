import { childEnv } from "../service/childEnv.ts";
import { InlineError } from "@polaris/protocol";
import { Effect, Option, Schema, Stream, type Scope } from "effect";
import { HarnessError } from "../harness/HarnessDriver.ts";
import type { InlineBackend } from "./backend.ts";
import type { StructuredJob } from "./structured.ts";
import { decodePatch, harnessPrompt, instructions, patchJsonSchema } from "./patch.ts";
import { stopChild } from "../platform/processes.ts";
import { launchArgv } from "../platform/cmdShim.ts";

const Event = Schema.Struct({
  type: Schema.String,
  event: Schema.optionalKey(
    Schema.Struct({
      delta: Schema.optionalKey(
        Schema.Struct({
          text: Schema.optionalKey(Schema.String),
          partial_json: Schema.optionalKey(Schema.String),
        })
      ),
    })
  ),
  structured_output: Schema.optionalKey(Schema.Unknown),
  is_error: Schema.optionalKey(Schema.Boolean),
  subtype: Schema.optionalKey(Schema.String),
});

export const claudeArgs = (job: Omit<StructuredJob, "prompt">): string[] => [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--json-schema",
  JSON.stringify(job.schema),
  "--system-prompt",
  job.instructions,
  ...(job.read ? ["--tools", "Read", "--allowedTools", "Read"] : ["--tools", ""]),
  "--permission-mode",
  "dontAsk",
  "--permission-prompts",
  "none",
  "--no-session-persistence",
  "--disable-slash-commands",
  "--restricted",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--settings",
  '{"disableAllHooks":true}',
  "--setting-sources",
  "",
  "--no-chrome",
  ...(job.model === null ? [] : ["--model", job.model]),
  ...(job.effort === null ? [] : ["--effort", job.effort]),
];

const failure = (message: string) => new HarnessError({ harness: "claude", message });

/** One print-mode request; closing the scope kills and reaps the process. */
export const claudeStructured = Effect.fn("harness.claude.structured")(function* (
  binary: string,
  job: StructuredJob,
  cwd: string,
  progress: (text: string) => Effect.Effect<void>
): Effect.fn.Return<unknown, HarnessError, Scope.Scope> {
  const proc = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.spawn(launchArgv(binary, claudeArgs(job)), {
          cwd,
          env: childEnv(),
          stdin: "pipe",
          stdout: "pipe",
          stderr: "ignore",
        }),
      catch: () => failure("Could not start Claude Code"),
    }),
    (child) =>
      Effect.promise(async () => {
        stopChild(child);
        await child.exited;
      })
  );

  yield* Effect.tryPromise({
    try: async () => {
      await proc.stdin.write(job.prompt);
      await proc.stdin.end();
    },
    catch: () => failure("Claude Code closed the input stream"),
  });
  let result: unknown;
  let completed = false;

  yield* Stream.fromReadableStream({
    evaluate: () => proc.stdout,
    onError: () => failure("Claude Code disconnected"),
  }).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) =>
      Effect.gen(function* () {
        const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Event))(line);

        if (Option.isNone(decoded)) return;

        const event = decoded.value;
        const text = event.event?.delta?.text ?? event.event?.delta?.partial_json;

        if (event.type === "stream_event" && text) yield* progress(text);

        if (event.type === "result") {
          if (event.is_error || event.subtype !== "success")
            return yield* failure("Claude Code did not complete the request");

          result = event.structured_output;
          completed = true;
        }
      })
    )
  );
  const code = yield* Effect.promise(() => proc.exited);

  if (code !== 0 || !completed)
    return yield* failure("Claude Code exited before returning structured output");

  return result;
});

export const claudeInline = (binary: string): InlineBackend =>
  Effect.fn("inline.claude")(function* (request, cwd, progress) {
    const job = {
      instructions,
      prompt: harnessPrompt(request),
      schema: patchJsonSchema,
      model: request.model,
      effort: request.effort,
      read: true,
    };

    const result = yield* claudeStructured(binary, job, cwd, progress).pipe(
      Effect.mapError(
        (error) => new InlineError({ reason: "harness-failed", message: error.message })
      )
    );

    return yield* decodePatch(result);
  });
