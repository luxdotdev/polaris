/**
 * `session/update` → `HarnessEvent`s for one Agent Session. ACP streams message
 * and thought text as chunks with no end marker, so a text item stays open
 * until something else happens in the Turn (a tool call, the other kind of
 * text, a new message id) or the Turn ends; then it is completed once.
 */
import { type TurnId, TurnItem } from "@polaris/protocol";
import { HarnessEvent } from "../HarnessDriver.ts";
import * as P from "./protocol.ts";

type ToolItemStatus = "running" | "completed" | "failed" | "declined";

interface TextSegment {
  readonly kind: "text" | "reasoning";
  readonly id: string;
  readonly messageId: string | null;
  text: string;
}

interface ToolCallState {
  fields: P.ToolCallFields;
  declined: boolean;
}

export interface TranslatorHooks {
  readonly emit: (event: HarnessEvent) => void;
  readonly onModeChanged: (modeId: string) => void;
  readonly onConfigOptions: (options: ReadonlyArray<P.ConfigOption>) => void;
}

const { ItemDelta, ItemUpdated, ItemCompleted } = HarnessEvent;

const blockText = (block: P.ContentBlock): string =>
  block.type === "text" && "text" in block ? block.text : "";

const toolStatus = (state: ToolCallState): ToolItemStatus => {
  if (state.declined) return "declined";

  if (state.fields.status === "completed") return "completed";

  return state.fields.status === "failed" ? "failed" : "running";
};

const contentText = (content: P.ToolCallFields["content"]): string =>
  (content ?? [])
    .map((c) => (c.type === "content" ? blockText(c.content) : ""))
    .filter((text) => text !== "")
    .join("\n");

const fileChanges = (fields: P.ToolCallFields) => {
  const deleting = fields.kind === "delete";

  const diffs = (fields.content ?? []).flatMap((c) =>
    c.type === "diff"
      ? [
          {
            path: c.path,
            kind: deleting ? "delete" : c.oldText == null ? "add" : "modify",
          } as const,
        ]
      : []
  );

  if (diffs.length > 0) return diffs;

  return (fields.locations ?? []).map(
    (location) => ({ path: location.path, kind: deleting ? "delete" : "modify" }) as const
  );
};

/** A tool call as the `TurnItem` it reads best as. */
export const toolCallItem = (state: ToolCallState, cwd: string): TurnItem => {
  const { fields } = state;
  const status = toolStatus(state);

  if (fields.kind === "execute")
    return TurnItem.cases.CommandExecution.make({
      id: fields.toolCallId,
      command: P.shellCommand(fields) ?? (fields.title || fields.name || "command"),
      cwd,
      output: contentText(fields.content),
      exitCode: P.exitCode(fields),
      status,
    });
  const changes = fields.kind === "edit" || fields.kind === "delete" || fields.kind === "move";

  if (changes && fileChanges(fields).length > 0)
    return TurnItem.cases.FileChange.make({
      id: fields.toolCallId,
      changes: fileChanges(fields),
      status,
    });
  const text = contentText(fields.content);

  return TurnItem.cases.ToolCall.make({
    id: fields.toolCallId,
    name: fields.name || fields.title || fields.kind || "tool",
    input: fields.rawInput ?? null,
    output: fields.rawOutput ?? (text === "" ? null : text),
    status,
  });
};

const planItem = (id: string, entries: ReadonlyArray<P.PlanEntry>) =>
  TurnItem.cases.Plan.make({
    id,
    steps: entries.map((entry) => ({
      text: entry.content,
      status: entry.status === "in_progress" ? "in-progress" : entry.status,
    })),
  });

/** Merges an update into what is known of a tool call; `null` and absent leave a field as it was. */
const merge = (
  previous: P.ToolCallFields | undefined,
  update: P.ToolCallFields
): P.ToolCallFields =>
  previous === undefined
    ? update
    : {
        toolCallId: update.toolCallId,
        title: update.title ?? previous.title,
        name: update.name ?? previous.name,
        kind: update.kind ?? previous.kind,
        status: update.status ?? previous.status,
        content: update.content ?? previous.content,
        locations: update.locations ?? previous.locations,
        rawInput: update.rawInput ?? previous.rawInput,
        rawOutput: update.rawOutput ?? previous.rawOutput,
      };

export interface Translator {
  /** Applies one decoded update; Turn items are dropped while no Turn is open. */
  readonly update: (turnId: TurnId | null, update: P.SessionUpdate) => void;
  /** Records a tool call the agent asks permission for (it may not have been announced). */
  readonly toolCall: (turnId: TurnId, fields: P.ToolCallFields) => void;
  /** Marks a tool call the user declined. */
  readonly decline: (turnId: TurnId, toolCallId: string) => void;
  /** Completes whatever the Turn left open: its text and its plan. */
  readonly endTurn: (turnId: TurnId) => void;
}

export const newTranslator = (cwd: string, hooks: TranslatorHooks): Translator => {
  let segment: TextSegment | null = null;
  let segments = 0;
  let errors = 0;
  let plan: ReadonlyArray<P.PlanEntry> | null = null;
  const toolCalls = new Map<string, ToolCallState>();

  const closeSegment = (turnId: TurnId) => {
    if (segment === null) return;
    const { id, text, kind } = segment;
    segment = null;
    hooks.emit(
      ItemCompleted({
        turnId,
        item:
          kind === "text"
            ? TurnItem.cases.AssistantMessage.make({ id, text })
            : TurnItem.cases.Reasoning.make({ id, text }),
      })
    );
  };

  const chunk = (
    turnId: TurnId,
    kind: TextSegment["kind"],
    messageId: string | null,
    text: string
  ) => {
    if (segment !== null && (segment.kind !== kind || segment.messageId !== messageId))
      closeSegment(turnId);

    if (segment === null)
      segment = { kind, id: `${turnId}:${kind}:${++segments}`, messageId, text: "" };
    segment.text += text;
    hooks.emit(ItemDelta({ turnId, itemId: segment.id, field: "text", text }));
  };

  const emitToolCall = (turnId: TurnId, state: ToolCallState) => {
    const item = toolCallItem(state, cwd);

    hooks.emit(
      toolStatus(state) === "running"
        ? ItemUpdated({ turnId, item })
        : ItemCompleted({ turnId, item })
    );
  };

  const applyToolCall = (turnId: TurnId, fields: P.ToolCallFields) => {
    closeSegment(turnId);
    const previous = toolCalls.get(fields.toolCallId);

    const state: ToolCallState = {
      fields: merge(previous?.fields, fields),
      declined: previous?.declined ?? false,
    };

    toolCalls.set(fields.toolCallId, state);
    emitToolCall(turnId, state);
  };

  const turnUpdate = (turnId: TurnId, update: P.SessionUpdate) => {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return chunk(turnId, "text", update.messageId ?? null, blockText(update.content));
      case "agent_thought_chunk":
        return chunk(turnId, "reasoning", update.messageId ?? null, blockText(update.content));
      case "tool_call":
      case "tool_call_update":
        return applyToolCall(turnId, update);
      case "plan":
        plan = update.entries;

        return hooks.emit(ItemUpdated({ turnId, item: planItem(`${turnId}:plan`, plan) }));
      case "notice":
        if (update.severity !== "error") return;
        closeSegment(turnId);

        return hooks.emit(
          ItemCompleted({
            turnId,
            item: TurnItem.cases.Error.make({
              id: `${turnId}:error:${++errors}`,
              message: [update.title, update.description].filter(Boolean).join(": "),
            }),
          })
        );
      default:
        return;
    }
  };

  return {
    update: (turnId, update) => {
      switch (update.sessionUpdate) {
        case "session_info_update":
          if (update.title) hooks.emit(HarnessEvent.TitleSuggested({ title: update.title }));

          return;
        case "current_mode_update":
          return hooks.onModeChanged(update.currentModeId);
        case "config_option_update":
          return hooks.onConfigOptions(update.configOptions);
        default:
          if (turnId !== null) turnUpdate(turnId, update);
      }
    },
    toolCall: (turnId, fields) => {
      if (!toolCalls.has(fields.toolCallId)) applyToolCall(turnId, fields);
    },
    decline: (turnId, toolCallId) => {
      const state = toolCalls.get(toolCallId);

      if (state === undefined) return;
      state.declined = true;
      emitToolCall(turnId, state);
    },
    endTurn: (turnId) => {
      closeSegment(turnId);

      if (plan !== null)
        hooks.emit(ItemCompleted({ turnId, item: planItem(`${turnId}:plan`, plan) }));
      plan = null;
      toolCalls.clear();
    },
  };
};
