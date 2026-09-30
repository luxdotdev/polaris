/**
 * Turn items as the conversation shows them: one shape for a completed
 * `TurnItem` and for an item still streaming (its `ItemProgress` and deltas).
 */
import type { TurnItem } from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { LiveItem } from "../../../store/sessionModel.ts";

export type ItemStatus = "running" | "completed" | "failed" | "declined";

export type FileChangeKind = "add" | "modify" | "delete";

export interface PlanStep {
  readonly text: string;
  readonly status: "pending" | "in-progress" | "completed";
  /** What the step is doing now (Claude's `activeForm`), when the Harness says. */
  readonly detail: string | null;
}

interface Base {
  readonly id: string;
  /** Still streaming: deltas or `ItemProgress`, no `TurnItemCompleted` yet. */
  readonly live: boolean;
}

export type ItemView =
  | (Base & { readonly kind: "message"; readonly text: string })
  /** A steer the Harness took, where it landed in the Turn. */
  | (Base & { readonly kind: "user"; readonly text: string })
  | (Base & {
      readonly kind: "reasoning";
      readonly text: string;
      /** When the Harness began and finished thinking; null when unknown. */
      readonly startedAt: string | null;
      readonly endedAt: string | null;
    })
  | (Base & {
      readonly kind: "command";
      readonly command: string;
      readonly output: string;
      readonly exitCode: number | null;
      readonly status: ItemStatus;
    })
  | (Base & {
      readonly kind: "files";
      readonly changes: ReadonlyArray<{ readonly path: string; readonly kind: FileChangeKind }>;
      readonly status: ItemStatus;
    })
  | (Base & {
      readonly kind: "tool";
      readonly name: string;
      readonly summary: string;
      readonly status: ItemStatus;
    })
  | (Base & {
      readonly kind: "plan";
      readonly steps: ReadonlyArray<PlanStep>;
      readonly explanation: string | null;
    })
  | (Base & { readonly kind: "error"; readonly message: string });

const SUMMARY_MAX = 160;

/** Whatever the Harness passed the tool, as it arrived (the protocol keeps it opaque). */
export type ToolInput = Extract<TurnItem, { readonly _tag: "ToolCall" }>["input"];

/** The argument that says what a tool call touched, in the order Harnesses name them. */
const SUBJECT_KEYS = ["file_path", "path", "command", "pattern", "query", "url", "description"];

const clip = (text: string) =>
  text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;

/**
 * What a tool call touched, on one line (rule/say-what-happened): its path, command or
 * query when it has one, else a string input as is, else compact JSON.
 */
export const toolSummary = (input: ToolInput): string => {
  if (input === null || input === undefined) return "";

  if (Predicate.isString(input)) return clip(input);

  const subject = SUBJECT_KEYS.map((key) =>
    Predicate.hasProperty(input, key) ? input[key] : undefined
  ).find(Predicate.isString);

  if (subject !== undefined) return clip(subject);

  return clip(JSON.stringify(input) ?? "");
};

const fromItem = (item: TurnItem, live: boolean): ItemView =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      AssistantMessage: (i): ItemView => ({ kind: "message", id: i.id, live, text: i.text }),
      UserMessage: (i): ItemView => ({ kind: "user", id: i.id, live, text: i.text }),
      Reasoning: (i): ItemView => ({
        kind: "reasoning",
        id: i.id,
        live,
        text: i.text,
        startedAt: i.startedAt,
        endedAt: i.endedAt,
      }),
      CommandExecution: (i): ItemView => ({
        kind: "command",
        id: i.id,
        live,
        command: i.command,
        output: i.output,
        exitCode: i.exitCode,
        status: i.status,
      }),
      FileChange: (i): ItemView => ({
        kind: "files",
        id: i.id,
        live,
        changes: i.changes,
        status: i.status,
      }),
      ToolCall: (i): ItemView => ({
        kind: "tool",
        id: i.id,
        live,
        name: i.name,
        summary: toolSummary(i.input),
        status: i.status,
      }),
      Plan: (i): ItemView => ({
        kind: "plan",
        id: i.id,
        live,
        steps: i.steps,
        explanation: i.explanation,
      }),
      Error: (i): ItemView => ({ kind: "error", id: i.id, live, message: i.message }),
    })
  );

const completedViews = new WeakMap<TurnItem, ItemView>();

/** A completed item's view; cached per item, so unchanged rows keep their identity. */
export const completedItemView = (item: TurnItem): ItemView => {
  const cached = completedViews.get(item);

  if (cached !== undefined) return cached;
  const view = fromItem(item, false);

  completedViews.set(item, view);

  return view;
};

/** Streamed text wins over the progress snapshot, which may lag a frame behind it. */
const withStreamed = (view: ItemView, live: LiveItem): ItemView => {
  if ((view.kind === "message" || view.kind === "reasoning") && live.text !== "")
    return { ...view, text: live.text };

  if (view.kind === "command" && live.output !== "") return { ...view, output: live.output };

  return view;
};

/** An item in progress. Without `ItemProgress` its kind is a guess: output deltas mean a command. */
export const liveItemView = (id: string, live: LiveItem): ItemView => {
  if (live.item !== null) return withStreamed(fromItem(live.item, true), live);

  if (live.output !== "" && live.text === "") {
    return {
      kind: "command",
      id,
      live: true,
      command: "",
      output: live.output,
      exitCode: null,
      status: "running",
    };
  }

  return { kind: "message", id, live: true, text: live.text };
};

export interface OutputTail {
  readonly text: string;
  /** Lines left out before `text`. */
  readonly hidden: number;
}

/** The last `lines` lines of command output, and how many were left out. */
export const outputTail = (output: string, lines: number): OutputTail => {
  const trimmed = output.endsWith("\n") ? output.slice(0, -1) : output;
  const all = trimmed.split("\n");

  if (all.length <= lines) return { text: trimmed, hidden: 0 };

  return { text: all.slice(-lines).join("\n"), hidden: all.length - lines };
};
