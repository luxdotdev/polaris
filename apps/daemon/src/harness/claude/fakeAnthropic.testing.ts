/**
 * A fake Anthropic Messages API for driving the real `claude` binary without a model: a Turn
 * makes the scripted tool calls one by one and records what each returned.
 */
import { Option, Schema } from "effect";

const ToolResult = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.optionalKey(Schema.Unknown),
});

const Body = Schema.Struct({
  stream: Schema.optionalKey(Schema.Boolean),
  tools: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      content: Schema.Unknown,
    })
  ),
});

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Body));

const decodeResult = Schema.decodeUnknownOption(ToolResult);

/** A message's content parts; plain-text content has none. */
const decodeParts = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));

type Block =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: object;
    };

const sse = (blocks: ReadonlyArray<Block>, stop: string) => {
  const events: Array<[string, object]> = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: `msg_${crypto.randomUUID()}`,
          type: "message",
          role: "assistant",
          model: "claude-fake",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ],
  ];

  blocks.forEach((block, index) => {
    const start = block.type === "text" ? { type: "text", text: "" } : { ...block, input: {} };

    const delta =
      block.type === "text"
        ? { type: "text_delta", text: block.text }
        : { type: "input_json_delta", partial_json: JSON.stringify(block.input) };

    events.push([
      "content_block_start",
      { type: "content_block_start", index, content_block: start },
    ]);
    events.push(["content_block_delta", { type: "content_block_delta", index, delta }]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);

  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
};

const decodeText = Schema.decodeUnknownOption(Schema.String);

/** A result's text, or its parts' JSON when it isn't plain text. */
const textOf = (result: typeof ToolResult.Type) =>
  Option.getOrElse(decodeText(result.content), () => JSON.stringify(result.content ?? null));

const DONE: ReadonlyArray<Block> = [{ type: "text", text: "done" }];

export interface ToolCall {
  readonly name: string;
  readonly input: object;
}

export const bash = (command: string): ToolCall => ({
  name: "Bash",
  input: { command, description: "probe" },
});

export interface FakeAnthropic {
  readonly url: string;
  /** What each scripted call returned, by its index in the script. */
  readonly outputs: Array<string>;
  /** The tool names each tool-offering request gave the model. */
  readonly offered: Array<ReadonlyArray<string>>;
  readonly stop: () => void;
}

/** Serves `calls`, in order, to the requests that offer tools (the session's, not a side query). */
export const fakeAnthropic = (calls: ReadonlyArray<ToolCall>): FakeAnthropic => {
  const outputs: Array<string> = [];
  const offered: Array<ReadonlyArray<string>> = [];

  const answer = (raw: string) => {
    const body = decodeBody(raw);
    const offersTools = Option.exists(body, (b) => (b.tools ?? []).length > 0);

    if (offersTools)
      offered.push(
        Option.match(body, { onNone: () => [], onSome: (b) => (b.tools ?? []).map((t) => t.name) })
      );

    const parts = Option.match(body, {
      onNone: () => [],
      onSome: (b) => b.messages.flatMap((m) => Option.getOrElse(decodeParts(m.content), () => [])),
    });

    const results = parts.flatMap((part) => Option.toArray(decodeResult(part)));

    for (const result of results) {
      const index = Number(result.tool_use_id.replace("toolu_probe_", ""));

      if (Number.isInteger(index)) outputs[index] = textOf(result);
    }

    const next = outputs.length;

    if (!offersTools || next >= calls.length)
      return {
        stream: Option.exists(body, (b) => b.stream === true),
        blocks: DONE,
        stop: "end_turn",
      };

    const call: Block = { type: "tool_use", id: `toolu_probe_${next}`, ...calls[next]! };

    return { stream: true, blocks: [call], stop: "tool_use" };
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;

      if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 1 });

      if (request.method !== "POST" || !path.endsWith("/v1/messages"))
        return Response.json({ data: [] });
      const { stream, blocks, stop } = answer(await request.text());

      if (stream)
        return new Response(sse(blocks, stop), {
          headers: { "content-type": "text/event-stream" },
        });

      return Response.json({
        id: "msg_fake",
        type: "message",
        role: "assistant",
        model: "claude-fake",
        content: blocks,
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    outputs,
    offered,
    stop: () => void server.stop(true),
  };
};
