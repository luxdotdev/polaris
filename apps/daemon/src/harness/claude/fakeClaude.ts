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
import { Predicate, type Schema } from "effect";
import type { QueryFn } from "./ClaudeDriver.ts";
import { Inbox } from "./inbox.ts";

/** A test's stand-in for an SDK content block, stream event or structured result. */
type Json = Schema.Json;

/** The members of `Query` the driver calls. */
type FakeQuery = Pick<
  Query,
  | "next"
  | "return"
  | "throw"
  | typeof Symbol.asyncIterator
  | "interrupt"
  | "setPermissionMode"
  | "setModel"
  | "applyFlagSettings"
  | "supportedModels"
  | "close"
  | "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"
>;

/** What the fake's permission callback is asked about. */
interface PermissionAsk {
  readonly toolUseID: string;
  readonly suggestions?: PermissionUpdate[];
  readonly signal?: AbortSignal;
}

export class FakeClaude {
  options: Options | null = null;
  readonly inputs: SDKUserMessage[] = [];
  readonly permissionModes: string[] = [];
  /** `setModel` calls; undefined is "back to the default". */
  readonly models: Array<string | undefined> = [];
  readonly flagSettings: Array<Parameters<Query["applyFlagSettings"]>[0]> = [];
  /** What `supportedModels()` answers. */
  modelInfos: Awaited<ReturnType<Query["supportedModels"]>> = [];
  interrupts = 0;
  closed = false;
  /** How often the driver asked `get_usage`, and what the fake answers (a reply or a failure). */
  usageCalls = 0;
  usageReply: Json | Error = { rate_limits_available: false, rate_limits: null };
  private readonly out = new Inbox<SDKMessage>();
  private inputWaiters: Array<() => void> = [];

  readonly query: QueryFn = ({ prompt, options }) => {
    this.options = options ?? null;

    if (!Predicate.isString(prompt)) void this.pump(prompt);
    const iterator = this.out[Symbol.asyncIterator]();

    const fake: FakeQuery = {
      next: () => iterator.next(),
      return: () => iterator.return!(),
      throw: (cause) => Promise.reject(cause),
      [Symbol.asyncIterator]: () => query,
      interrupt: async () => {
        this.interrupts++;

        return undefined;
      },
      setPermissionMode: async (mode) => {
        this.permissionModes.push(mode);
      },
      setModel: async (model) => {
        this.models.push(model);
      },
      applyFlagSettings: async (settings) => {
        this.flagSettings.push(settings);
      },
      supportedModels: async () => this.modelInfos,
      close: () => {
        this.closed = true;
        this.out.end();
      },
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        this.usageCalls++;

        if (this.usageReply instanceof Error) throw this.usageReply;

        // SAFETY: the driver decodes the reply with its own schema before reading it.
        return this.usageReply as Awaited<
          ReturnType<Query["usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"]>
        >;
      },
    };

    // SAFETY: the driver calls only the members of `Query` that `FakeQuery` picks.
    const query = fake as Query;

    return query;
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

  emit(message: FakeMessage): void {
    // SAFETY: the driver reads only the fields the builders below set on each message.
    this.out.push(message as SDKMessage);
  }

  /** The `claude` child exits on its own. */
  exit(): void {
    this.out.end();
  }

  askPermission(
    toolName: string,
    input: Record<string, Json>,
    extra: PermissionAsk
  ): Promise<PermissionResult | null> {
    const canUseTool = this.options?.canUseTool;

    if (!canUseTool) throw new Error("canUseTool was not provided");

    const context: Parameters<typeof canUseTool>[2] = {
      signal: extra.signal ?? new AbortController().signal,
      toolUseID: extra.toolUseID,
      requestId: `req-${extra.toolUseID}`,
    };

    if (extra.suggestions) context.suggestions = extra.suggestions;

    return canUseTool(toolName, input, context);
  }
}

// Builders for the SDK messages the tests script.
export const init = (sessionId: string) => ({
  type: "system" as const,
  subtype: "init" as const,
  session_id: sessionId,
  uuid: crypto.randomUUID(),
});

export const assistant = (id: string, content: ReadonlyArray<Json>) => ({
  type: "assistant" as const,
  message: { id, role: "assistant" as const, content },
  parent_tool_use_id: null,
  uuid: crypto.randomUUID(),
  session_id: "s",
});

interface ToolResultOptions {
  readonly isError?: boolean;
  readonly structured?: Json;
}

interface FakeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: true;
}

export const toolResult = (toolUseId: string, content: string, options: ToolResultOptions = {}) => {
  const block: FakeToolResultBlock = {
    type: "tool_result",
    tool_use_id: toolUseId,
    content,
  };

  if (options.isError) block.is_error = true;

  return {
    type: "user" as const,
    message: { role: "user" as const, content: [block] },
    parent_tool_use_id: null,
    tool_use_result: options.structured,
    session_id: "s",
  };
};

export const streamEvent = (event: Json) => ({
  type: "stream_event" as const,
  event,
  parent_tool_use_id: null,
  uuid: crypto.randomUUID(),
  session_id: "s",
});

interface ResultOptions {
  readonly subtype?: string;
  readonly isError?: boolean;
  readonly text?: string;
  readonly errors?: string[];
}

interface FakeResult {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  errors: string[];
  session_id: string;
  uuid: string;
  user_message_uuids?: string[];
  user_message_uuid?: string | undefined;
}

export const result = (uuids: string[] | null, options: ResultOptions = {}) => {
  const message: FakeResult = {
    type: "result",
    subtype: options.subtype ?? "success",
    is_error: options.isError ?? false,
    result: options.text ?? "",
    errors: options.errors ?? [],
    session_id: "s",
    uuid: crypto.randomUUID(),
  };

  if (uuids) {
    message.user_message_uuids = uuids;
    message.user_message_uuid = uuids.at(-1);
  }

  return message;
};

export const rateLimitEvent = (info: Json) => ({
  type: "rate_limit_event" as const,
  rate_limit_info: info,
  uuid: crypto.randomUUID(),
  session_id: "s",
});

/** A message the fake Claude sends: one of the builders' shapes. */
export type FakeMessage =
  | ReturnType<typeof rateLimitEvent>
  | ReturnType<typeof init>
  | ReturnType<typeof assistant>
  | ReturnType<typeof toolResult>
  | ReturnType<typeof streamEvent>
  | ReturnType<typeof result>;
