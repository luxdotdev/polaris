/**
 * A Subagent as the conversation shows it, under the Turn that spawned it:
 * its task, what it is doing now, its own items (grouped like the Turn's),
 * and its final report: the Harness's report (Claude's SubagentHandback), else
 * its last message, else what its Agent call returned to the Turn.
 */
import { Option, Predicate, Schema } from "effect";
import type { Subagent, TurnItem } from "@polaris/protocol";
import type { SubagentView } from "../../../store/sessionModel.ts";
import { completedItemView, type ItemView, liveItemView } from "./items.ts";
import { type Entry, groupItems } from "./runs.ts";

export interface SubagentCard {
  readonly id: string;
  readonly subagent: Subagent;
  /** What the Turn asked it to do, when the call says. */
  readonly task: string | null;
  readonly entries: ReadonlyArray<Entry>;
  /** Its final answer, once it has one. */
  readonly report: string | null;
  /** One line on what it is doing now, while it works. */
  readonly activity: string | null;
}

type ToolCall = Extract<TurnItem, { readonly _tag: "ToolCall" }>;

const NonBlank = Schema.String.check(Schema.isPattern(/\S/));

/** Claude's Agent call input: the task and its short title. */
const decodeAgentInput = Schema.decodeUnknownOption(
  Schema.Struct({ prompt: Schema.optional(NonBlank), description: Schema.optional(NonBlank) })
);

/** A tool's result: plain text, or MCP-style content parts (Claude's Agent result). */
const decodeResult = Schema.decodeUnknownOption(
  Schema.Union([
    NonBlank,
    Schema.Struct({
      content: Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) })),
    }),
  ])
);

/** The task: the call's `prompt` (Claude's Agent tool), else its description. */
const taskOf = (call: ToolCall | undefined) =>
  call === undefined
    ? null
    : Option.match(decodeAgentInput(call.input), {
        onNone: () => null,
        onSome: (input) => input.prompt ?? input.description ?? null,
      });

/** Text a tool call returned: a string, or the text parts of a `content` array. */
export const resultText = (output: ToolCall["output"]): string | null =>
  Option.match(decodeResult(output), {
    onNone: () => null,
    onSome: (result) => {
      if (Predicate.isString(result)) return result;

      const text = result.content
        .flatMap((part) => (part.text === undefined ? [] : [part.text]))
        .join("\n\n")
        .trim();

      return text === "" ? null : text;
    },
  });

const ACTIVITY: Partial<Record<ItemView["kind"], (item: ItemView) => string>> = {
  message: () => "Writing",
  reasoning: () => "Thinking",
  command: (i) =>
    i.kind === "command" && i.command !== "" ? `Running ${i.command}` : "Running a command",
  files: (i) => (i.kind === "files" ? `Editing ${i.changes[0]?.path ?? "files"}` : "Editing"),
  tool: (i) => (i.kind === "tool" ? `${i.name} ${i.summary}`.trim() : "Using a tool"),
};

const activityOf = (live: ReadonlyArray<ItemView>, done: ReadonlyArray<ItemView>) => {
  const now = live.at(-1) ?? done.at(-1);

  return now === undefined ? "Starting" : (ACTIVITY[now.kind]?.(now) ?? "Working");
};

type Message = Extract<TurnItem, { readonly _tag: "AssistantMessage" }>;

const isMessage = (item: TurnItem): item is Message =>
  Predicate.isTagged(item, "AssistantMessage") && item.text.trim() !== "";

export const subagentCard = (view: SubagentView, call: ToolCall | undefined): SubagentCard => {
  const done = view.items.map(completedItemView);
  const live = [...view.live].map(([id, item]) => liveItemView(id, item));
  const working = view.subagent.status === "working";
  const handed = view.subagent.report ?? null;
  const last = working || handed !== null ? undefined : view.items.findLast(isMessage);
  const report = handed ?? (working ? null : (last?.text ?? resultText(call?.output)));
  // The report shows on its own under the card; the transcript keeps everything else.
  const shown = last === undefined ? done : done.filter((i) => i.id !== last.id);

  return {
    id: view.subagent.id,
    subagent: view.subagent,
    task: taskOf(call),
    entries: groupItems([...shown, ...live]),
    report,
    activity: working ? activityOf(live, done) : null,
  };
};
