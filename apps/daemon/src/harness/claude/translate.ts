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
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnId, TurnItem } from "@polaris/protocol";
import type { HarnessEvent } from "../HarnessDriver.ts";

type ToolStatus = "running" | "completed" | "failed" | "declined";

const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const str = (u: unknown): string | null => (typeof u === "string" ? u : null);

/** Text of a `tool_result` content (a string or an array of content blocks). */
export const toolResultText = (content: unknown): string => {
  if (typeof content === "string") return content;

  if (!Array.isArray(content)) return "";

  return content
    .flatMap((b) =>
      isRecord(b) && b.type === "text" && typeof b.text === "string" ? [b.text] : []
    )
    .join("\n");
};

const PLAN_STATUS = {
  pending: "pending",
  in_progress: "in-progress",
  completed: "completed",
} as const;

export const planSteps = (input: unknown) =>
  isRecord(input) && Array.isArray(input.todos)
    ? input.todos.flatMap((t) => {
        if (!isRecord(t)) return [];
        const text = str(t.content);
        const status = PLAN_STATUS[t.status as keyof typeof PLAN_STATUS];

        return text === null || status === undefined ? [] : [{ text, status }];
      })
    : [];

/** Build the `TurnItem` for one tool call, in any state. */
export const toolItem = (options: {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly cwd: string;
  readonly status: ToolStatus;
  readonly resultText: string | null;
  /** The structured `tool_use_result`, when the SDK attached one. */
  readonly structured: unknown;
}): TurnItem => {
  const { id, name, input, cwd, status, resultText, structured } = options;
  const i = isRecord(input) ? input : {};

  switch (name) {
    case "Bash": {
      const s = isRecord(structured) ? structured : null;

      const output =
        s && (typeof s.stdout === "string" || typeof s.stderr === "string")
          ? [str(s.stdout), str(s.stderr)].filter((x) => x).join("\n")
          : (resultText ?? "");

      return {
        _tag: "CommandExecution",
        id,
        command: str(i.command) ?? "",
        cwd,
        output,
        // Claude Code reports a non-zero exit only as an error result, without the code.
        exitCode: null,
        status,
      };
    }

    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit": {
      const path = str(i.file_path) ?? str(i.notebook_path) ?? "";
      const created = isRecord(structured) && structured.type === "create";
      const deleted = name === "NotebookEdit" && i.edit_mode === "delete";

      return {
        _tag: "FileChange",
        id,
        changes: [{ path, kind: created ? "add" : deleted ? "delete" : "modify" }],
        status,
      };
    }

    default:
      return {
        _tag: "ToolCall",
        id,
        name,
        input,
        output: status === "running" ? null : (structured ?? resultText),
        status,
      };
  }
};

interface OpenTool {
  readonly name: string;
  readonly input: unknown;
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
      events.push({ _tag: "ItemCompleted", turnId, item: plan });
    }

    for (const [id, tool] of this.tools) {
      if (tool.turnId !== turnId || tool.name === "TodoWrite") continue;
      events.push({
        _tag: "ItemCompleted",
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
      });
      this.tools.delete(id);
    }

    return events;
  }

  onMessage(message: SDKMessage): HarnessEvent[] {
    switch (message.type) {
      case "system":
        if (message.subtype === "init" && message.session_id !== this.cursor) {
          this.cursor = message.session_id;

          return [{ _tag: "CursorAssigned", cursor: message.session_id }];
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

  private onStreamEvent(event: unknown): HarnessEvent[] {
    if (!isRecord(event) || this.turnId === null) return [];

    if (event.type === "message_start" && isRecord(event.message)) {
      this.streamMessageId = str(event.message.id);

      return [];
    }

    if (event.type !== "content_block_delta" || this.streamMessageId === null) return [];
    const delta = event.delta;

    if (!isRecord(delta) || typeof event.index !== "number") return [];

    const text =
      delta.type === "text_delta"
        ? str(delta.text)
        : delta.type === "thinking_delta"
          ? str(delta.thinking)
          : null;

    if (text === null || text === "") return [];

    return [
      {
        _tag: "ItemDelta",
        turnId: this.turnId,
        itemId: `${this.streamMessageId}:${event.index}`,
        field: "text",
        text,
      },
    ];
  }

  private onAssistant(messageId: string, content: unknown): HarnessEvent[] {
    const turnId = this.turnId;

    if (turnId === null || !Array.isArray(content)) return [];
    const events: HarnessEvent[] = [];

    for (const block of content) {
      // Blocks of one message arrive in order, one or more per SDK message, so the running
      // count is the block's index: the same id its stream deltas used.
      const index = this.delivered.get(messageId) ?? 0;
      this.delivered.set(messageId, index + 1);

      if (!isRecord(block)) continue;
      const id = `${messageId}:${index}`;

      if (block.type === "text" && typeof block.text === "string" && block.text !== "") {
        events.push({
          _tag: "ItemCompleted",
          turnId,
          item: { _tag: "AssistantMessage", id, text: block.text },
        });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        if (block.thinking !== "")
          events.push({
            _tag: "ItemCompleted",
            turnId,
            item: { _tag: "Reasoning", id, text: block.thinking },
          });
      } else if (block.type === "tool_use" && typeof block.id === "string") {
        const name = str(block.name) ?? "unknown";

        if (name === "TodoWrite") {
          const plan: TurnItem = {
            _tag: "Plan",
            id: `plan:${turnId}`,
            steps: planSteps(block.input),
          };

          this.plans.set(turnId, plan);
          events.push({ _tag: "ItemUpdated", turnId, item: plan });
        }

        this.tools.set(block.id, { name, input: block.input, turnId });

        if (name !== "TodoWrite") {
          events.push({
            _tag: "ItemUpdated",
            turnId,
            item: toolItem({
              id: block.id,
              name,
              input: block.input,
              cwd: this.cwd,
              status: "running",
              resultText: null,
              structured: null,
            }),
          });
        }
      }
    }

    return events;
  }

  private onUser(content: unknown, structured: unknown): HarnessEvent[] {
    if (!Array.isArray(content)) return [];

    const results = content.filter(
      (b): b is Record<string, unknown> =>
        isRecord(b) && b.type === "tool_result" && typeof b.tool_use_id === "string"
    );

    const events: HarnessEvent[] = [];

    for (const block of results) {
      const id = block.tool_use_id as string;
      const tool = this.tools.get(id);

      if (!tool) continue;
      this.tools.delete(id);

      if (tool.name === "TodoWrite") continue;

      const status: ToolStatus = this.declined.delete(id)
        ? "declined"
        : block.is_error === true
          ? "failed"
          : "completed";

      events.push({
        _tag: "ItemCompleted",
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
      });
    }

    return events;
  }
}
