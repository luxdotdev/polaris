/**
 * A scripted stand-in for the Agent SDK's `query()`, for tests. The test pushes
 * SDK messages with `emit`, reads what the driver sent with `nextInput`, and can
 * call the driver's `canUseTool` like the `claude` child would.
 */
import type {
  Options,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { QueryFn } from "./ClaudeDriver.ts";
import { Inbox } from "./inbox.ts";

export class FakeClaude {
  options: Options | null = null;
  readonly inputs: SDKUserMessage[] = [];
  readonly permissionModes: string[] = [];
  interrupts = 0;
  closed = false;
  private readonly out = new Inbox<SDKMessage>();
  private inputWaiters: Array<() => void> = [];

  readonly query: QueryFn = ({ prompt, options }) => {
    this.options = options ?? null;
    if (typeof prompt !== "string") void this.pump(prompt);
    const iterator = this.out[Symbol.asyncIterator]();
    const self = this;
    const q = {
      next: () => iterator.next(),
      return: () => iterator.return!(),
      throw: (e: unknown) => Promise.reject(e),
      [Symbol.asyncIterator]() {
        return this;
      },
      interrupt: async () => {
        self.interrupts++;
        return undefined;
      },
      setPermissionMode: async (mode: string) => {
        self.permissionModes.push(mode);
      },
      close: () => {
        self.closed = true;
        self.out.end();
      },
    };
    return q as unknown as Query;
  };

  private async pump(prompt: AsyncIterable<SDKUserMessage>) {
    for await (const message of prompt) {
      this.inputs.push(message);
      for (const w of this.inputWaiters.splice(0)) w();
    }
  }

  /** Resolves with the n-th (0-based) user message the driver sent. */
  async nextInput(n: number): Promise<SDKUserMessage> {
    while (this.inputs.length <= n) await new Promise<void>((r) => this.inputWaiters.push(r));
    return this.inputs[n]!;
  }

  emit(message: unknown): void {
    this.out.push(message as SDKMessage);
  }

  /** The `claude` child exits on its own. */
  exit(): void {
    this.out.end();
  }

  askPermission(
    toolName: string,
    input: Record<string, unknown>,
    extra: { toolUseID: string; suggestions?: PermissionUpdate[]; signal?: AbortSignal }
  ): Promise<PermissionResult | null> {
    const canUseTool = this.options?.canUseTool;
    if (!canUseTool) throw new Error("canUseTool was not provided");
    return canUseTool(toolName, input, {
      signal: extra.signal ?? new AbortController().signal,
      toolUseID: extra.toolUseID,
      requestId: `req-${extra.toolUseID}`,
      ...(extra.suggestions ? { suggestions: extra.suggestions } : {}),
    });
  }
}

// Builders for the SDK messages the tests script.
export const init = (sessionId: string) => ({
  type: "system",
  subtype: "init",
  session_id: sessionId,
  uuid: crypto.randomUUID(),
});

export const assistant = (id: string, content: unknown[]) => ({
  type: "assistant",
  message: { id, role: "assistant", content },
  parent_tool_use_id: null,
  uuid: crypto.randomUUID(),
  session_id: "s",
});

export const toolResult = (
  toolUseId: string,
  content: string,
  options: { isError?: boolean; structured?: unknown } = {}
) => ({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: toolUseId,
        content,
        ...(options.isError ? { is_error: true } : {}),
      },
    ],
  },
  parent_tool_use_id: null,
  tool_use_result: options.structured,
  session_id: "s",
});

export const streamEvent = (event: unknown) => ({
  type: "stream_event",
  event,
  parent_tool_use_id: null,
  uuid: crypto.randomUUID(),
  session_id: "s",
});

export const result = (
  uuids: string[] | null,
  options: { subtype?: string; isError?: boolean; text?: string; errors?: string[] } = {}
) => ({
  type: "result",
  subtype: options.subtype ?? "success",
  is_error: options.isError ?? false,
  result: options.text ?? "",
  errors: options.errors ?? [],
  ...(uuids ? { user_message_uuids: uuids, user_message_uuid: uuids.at(-1) } : {}),
  session_id: "s",
  uuid: crypto.randomUUID(),
});
