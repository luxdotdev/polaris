import { childEnv } from "../service/childEnv.ts";
import { InlineError } from "@polaris/protocol";
import { Effect, Option, Schema, Stream } from "effect";
import type { InlineBackend } from "./backend.ts";
import { decodePatch, harnessPrompt, instructions, patchJsonSchema } from "./patch.ts";

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

export const claudeArgs = (model: string | null, effort: string | null): string[] => [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--json-schema",
  JSON.stringify(patchJsonSchema),
  "--system-prompt",
  instructions,
  "--tools",
  "Read",
  "--allowedTools",
  "Read",
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
  ...(model === null ? [] : ["--model", model]),
  ...(effort === null ? [] : ["--effort", effort]),
];

export const claudeInline = (binary: string): InlineBackend =>
  Effect.fn("inline.claude")(function* (request, cwd, progress) {
    const proc = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          Bun.spawn([binary, ...claudeArgs(request.model, request.effort)], {
            cwd,
            env: childEnv(),
            stdin: "pipe",
            stdout: "pipe",
            stderr: "ignore",
          }),
        catch: () =>
          new InlineError({ reason: "harness-failed", message: "Could not start Claude Code" }),
      }),
      (child) =>
        Effect.promise(async () => {
          child.kill();
          await child.exited;
        })
    );

    yield* Effect.tryPromise({
      try: async () => {
        await proc.stdin.write(harnessPrompt(request));
        await proc.stdin.end();
      },
      catch: () =>
        new InlineError({
          reason: "harness-failed",
          message: "Claude Code closed the input stream",
        }),
    });
    let result: unknown;
    let completed = false;

    yield* Stream.fromReadableStream({
      evaluate: () => proc.stdout,
      onError: () =>
        new InlineError({ reason: "harness-failed", message: "Claude Code disconnected" }),
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
              return yield* new InlineError({
                reason: "harness-failed",
                message: "Claude Code did not complete the inline proposal",
              });

            result = event.structured_output;
            completed = true;
          }
        })
      )
    );
    const code = yield* Effect.promise(() => proc.exited);

    if (code !== 0 || !completed)
      return yield* new InlineError({
        reason: "harness-failed",
        message: "Claude Code exited before returning a patch",
      });

    return yield* decodePatch(result);
  });
