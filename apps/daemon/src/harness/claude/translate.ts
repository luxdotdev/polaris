/**
 * Translates Agent SDK messages into normalized `HarnessEvent`s and `TurnItem`s.
 *
 * Stateful but free of effects, so it is unit-testable on recorded messages.
 * Turn accounting (which `result` ends which Turn) lives in the session, not here.
 *
 * A tool call is live progress (`ItemUpdated`, `running`) when its `tool_use`
 * block arrives, and one `ItemCompleted` with the final status when its
 * `tool_result` does. TodoWrite updates the Turn's plan live the same way; the
 * plan is completed once, with its last state, when the Turn ends.
 */
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { type TurnId, TurnItem } from "@polaris/protocol";
import { Option, Predicate } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";
import {
  type AssistantBlock,
  decodeAssistantContent,
  decodeTodos,
  decodeToolResultContent,
  decodeToolResults,
  present,
  type ToolPayload,
  toolFields,
} from "./payloads.ts";

type ToolStatus = "running" | "completed" | "failed" | "declined";

const { CursorAssigned, ItemCompleted, ItemDelta, ItemUpdated } = HarnessEvent;

type BlockDelta = Extract<
  SDKPartialAssistantMessage["event"],
  { readonly type: "content_block_delta" }
>["delta"];

/** A streamed text or thinking chunk; null for other deltas (tool input JSON, signatures). */
const deltaText = (delta: BlockDelta): string | null => {
  switch (delta.type) {
    case "text_delta":
      return delta.text;
    case "thinking_delta":
      return delta.thinking;
    default:
      return null;
  }
};

/** Text of a `tool_result` content (a string or an array of content blocks). */
export const toolResultText = (content: ToolPayload): string =>
  Option.match(decodeToolResultContent(content), {
    onNone: () => "",
    onSome: (decoded) =>
      Predicate.isString(decoded)
        ? decoded
        : present(decoded)
            .map((block) => block.text)
            .join("\n"),
  });

const PLAN_STATUS = {
  pending: "pending",
  in_progress: "in-progress",
  completed: "completed",
} as const;

export const planSteps = (input: ToolPayload) =>
  Option.match(decodeTodos(input), {
    onNone: () => [],
    onSome: ({ todos }) =>
      present(todos).map((todo) => ({ text: todo.content, status: PLAN_STATUS[todo.status] })),
  });

/** The live plan of a Turn, from a TodoWrite call's input. */
export const planItem = (turnId: TurnId, input: ToolPayload): TurnItem =>
  TurnItem.cases.Plan.make({ id: `plan:${turnId}`, steps: planSteps(input) });

/** One tool call, in any state. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: ToolPayload;
  readonly cwd: string;
  readonly status: ToolStatus;
  readonly resultText: string | null;
  /** The structured `tool_use_result`, when the SDK attached one. */
  readonly structured: ToolPayload;
}

const FILE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

const commandItem = (call: ToolCall): TurnItem => {
  const result = toolFields(call.structured);
  const streams = [result.stdout, result.stderr];

  const output =
    result.stdout !== null || result.stderr !== null
      ? streams.flatMap((text) => (text ? [text] : [])).join("\n")
      : (call.resultText ?? "");

  return TurnItem.cases.CommandExecution.make({
    id: call.id,
    command: toolFields(call.input).command ?? "",
    cwd: call.cwd,
    output,
    // Claude Code reports a non-zero exit only as an error result, without the code.
    exitCode: null,
    status: call.status,
  });
};

const fileChangeKind = (call: ToolCall, editMode: string | null) => {
  if (toolFields(call.structured).type === "create") return "add";

  return call.name === "NotebookEdit" && editMode === "delete" ? "delete" : "modify";
};

const fileChangeItem = (call: ToolCall): TurnItem => {
  const input = toolFields(call.input);

  return TurnItem.cases.FileChange.make({
    id: call.id,
    changes: [
      {
        path: input.file_path ?? input.notebook_path ?? "",
        kind: fileChangeKind(call, input.edit_mode),
      },
    ],
    status: call.status,
  });
};

/** Build the `TurnItem` for one tool call, in any state. */
export const toolItem = (call: ToolCall): TurnItem => {
  if (call.name === "Bash") return commandItem(call);

  if (FILE_TOOLS.has(call.name)) return fileChangeItem(call);

  return TurnItem.cases.ToolCall.make({
    id: call.id,
    name: call.name,
    input: call.input,
    output: call.status === "running" ? null : (call.structured ?? call.resultText),
    status: call.status,
  });
};

interface OpenTool {
  readonly name: string;
  readonly input: ToolPayload;
  readonly turnId: TurnId;
}

export class ClaudeTranslator {
  private cursor: string | null;
  private turnId: TurnId | null = null;
  /** Top-level message id of the stream currently being delivered. */
  private streamMessageId: string | null = null;
  /** How many content blocks of each assistant message id were delivered. */
  private readonly delivered = new Map<string, number>();
  private readonly tools = new Map<string, OpenTool>();
  private readonly declined = new Set<string>();
  /** The latest TodoWrite plan of each Turn, completed when the Turn ends. */
  private readonly plans = new Map<TurnId, TurnItem>();

  constructor(
    private readonly cwd: string,
    cursor: string | null = null
  ) {
    this.cursor = cursor;
  }

  get sessionCursor(): string | null {
    return this.cursor;
  }

  beginTurn(turnId: TurnId): void {
    this.turnId = turnId;
  }

  endTurn(): void {
    this.turnId = null;
    this.streamMessageId = null;
    this.delivered.clear();
  }

  /** The user (or an interrupt) declined this tool call; its result reads as `declined`. */
  markDeclined(toolUseId: string): void {
    this.declined.add(toolUseId);
  }

  /**
   * At Turn end: items still open (e.g. interrupted mid-tool) complete as failed or
   * declined, and the Turn's plan completes with its last state.
   */
  closeOpenTools(turnId: TurnId, status: "failed" | "declined"): HarnessEvent[] {
    const events: HarnessEvent[] = [];
    const plan = this.plans.get(turnId);

    if (plan !== undefined) {
      this.plans.delete(turnId);
      events.push(ItemCompleted({ turnId, item: plan }));
    }

    for (const [id, tool] of this.tools) {
      if (tool.turnId !== turnId || tool.name === "TodoWrite") continue;
      events.push(
        ItemCompleted({
          turnId,
          item: toolItem({
            id,
            name: tool.name,
            input: tool.input,
            cwd: this.cwd,
            status,
            resultText: null,
            structured: null,
          }),
        })
      );
      this.tools.delete(id);
    }

    return events;
  }

  onMessage(message: SDKMessage): HarnessEvent[] {
    switch (message.type) {
      case "system":
        if (message.subtype === "init" && message.session_id !== this.cursor) {
          this.cursor = message.session_id;

          return [CursorAssigned({ cursor: message.session_id })];
        }

        return [];
      case "stream_event":
        return message.parent_tool_use_id === null ? this.onStreamEvent(message.event) : [];
      case "assistant":
        return message.parent_tool_use_id === null
          ? this.onAssistant(message.message.id, message.message.content)
          : [];
      case "user":
        return message.parent_tool_use_id === null && !("isReplay" in message && message.isReplay)
          ? this.onUser(message.message.content, message.tool_use_result)
          : [];
      default:
        return [];
    }
  }

  /** Runs once per streamed chunk; the SDK types these events, so they need no parsing. */
  private onStreamEvent(event: SDKPartialAssistantMessage["event"]): HarnessEvent[] {
    if (this.turnId === null) return [];

    if (event.type === "message_start") {
      this.streamMessageId = event.message.id;

      return [];
    }

    if (event.type !== "content_block_delta" || this.streamMessageId === null) return [];
    const text = deltaText(event.delta);

    if (text === null || text === "") return [];

    return [
      ItemDelta({
        turnId: this.turnId,
        itemId: `${this.streamMessageId}:${event.index}`,
        field: "text",
        text,
      }),
    ];
  }

  private onAssistant(
    messageId: string,
    content: SDKAssistantMessage["message"]["content"]
  ): HarnessEvent[] {
    const turnId = this.turnId;
    const blocks = decodeAssistantContent(content);

    if (turnId === null || Option.isNone(blocks)) return [];

    return blocks.value.flatMap((block) => {
      // Blocks of one message arrive in order, one or more per SDK message, so the running
      // count is the block's index: the same id its stream deltas used.
      const index = this.delivered.get(messageId) ?? 0;
      this.delivered.set(messageId, index + 1);

      return block === null ? [] : this.onAssistantBlock(turnId, `${messageId}:${index}`, block);
    });
  }

  private onAssistantBlock(turnId: TurnId, id: string, block: AssistantBlock): HarnessEvent[] {
    switch (block.type) {
      case "text":
        return block.text === ""
          ? []
          : [
              ItemCompleted({
                turnId,
                item: TurnItem.cases.AssistantMessage.make({ id, text: block.text }),
              }),
            ];
      case "thinking":
        return block.thinking === ""
          ? []
          : [
              ItemCompleted({
                turnId,
                item: TurnItem.cases.Reasoning.make({ id, text: block.thinking }),
              }),
            ];
      case "tool_use":
        return this.onToolUse(turnId, block.id, block.name ?? "unknown", block.input);
    }
  }

  private onToolUse(turnId: TurnId, id: string, name: string, input: ToolPayload): HarnessEvent[] {
    this.tools.set(id, { name, input, turnId });

    if (name === "TodoWrite") {
      const plan = planItem(turnId, input);
      this.plans.set(turnId, plan);

      return [ItemUpdated({ turnId, item: plan })];
    }

    return [
      ItemUpdated({
        turnId,
        item: toolItem({
          id,
          name,
          input,
          cwd: this.cwd,
          status: "running",
          resultText: null,
          structured: null,
        }),
      }),
    ];
  }

  private onUser(
    content: SDKUserMessage["message"]["content"],
    structured: SDKUserMessage["tool_use_result"]
  ): HarnessEvent[] {
    const decoded = decodeToolResults(content);

    if (Option.isNone(decoded)) return [];
    const results = present(decoded.value);

    const events: HarnessEvent[] = [];

    for (const block of results) {
      const id = block.tool_use_id;
      const tool = this.tools.get(id);

      if (!tool) continue;
      this.tools.delete(id);

      if (tool.name === "TodoWrite") continue;

      const status: ToolStatus = this.declined.delete(id)
        ? "declined"
        : block.is_error === true
          ? "failed"
          : "completed";

      events.push(
        ItemCompleted({
          turnId: tool.turnId,
          item: toolItem({
            id,
            name: tool.name,
            input: tool.input,
            cwd: this.cwd,
            status,
            resultText: toolResultText(block.content),
            // The SDK attaches one structured result per message; trust it only when unambiguous.
            structured: results.length === 1 ? structured : null,
          }),
        })
      );
    }

    return events;
  }
}
