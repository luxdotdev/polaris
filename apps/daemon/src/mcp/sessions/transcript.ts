/** A session's recent Turns as compact text for another agent to read (`read_worker`). */
import { placeItem, type Turn, type TurnItem } from "@polaris/protocol";
import { Match } from "effect";

/** The whole answer stays well inside a model's tool-result budget. */
export const TRANSCRIPT_LIMIT = 16_000;

const TEXT_LIMIT = 2_000;

const OUTPUT_LINES = 8;

const clip = (text: string, limit = TEXT_LIMIT) =>
  text.length <= limit ? text : `${text.slice(0, limit)}… (${text.length - limit} more characters)`;

const tail = (output: string) => {
  const lines = output.trimEnd().split("\n");

  if (lines.length <= OUTPUT_LINES) return lines.join("\n");

  return [`… ${lines.length - OUTPUT_LINES} earlier lines`, ...lines.slice(-OUTPUT_LINES)].join(
    "\n"
  );
};

const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

const itemLine = Match.type<TurnItem>().pipe(
  Match.tagsExhaustive({
    AssistantMessage: (item) => `Assistant: ${clip(item.text)}`,
    UserMessage: (item) => `User (steer): ${clip(item.text)}`,
    Reasoning: () => null,
    CommandExecution: (item) => {
      const head = `$ ${clip(item.command, 300)} (${item.exitCode === null ? item.status : `exit ${item.exitCode}`})`;

      return item.output.trim() === "" ? head : `${head}\n${indent(clip(tail(item.output)))}`;
    },
    FileChange: (item) =>
      `Changed ${item.changes.map((change) => `${change.kind} ${change.path}`).join(", ")}`,
    ToolCall: (item) => `Tool ${item.name} (${item.status})`,
    Plan: (item) => `Plan: ${item.steps.map((step) => `[${step.status}] ${step.text}`).join("; ")}`,
    Error: (item) => `Error: ${clip(item.message)}`,
  })
);

export interface TranscriptTurn {
  readonly turn: Turn;
  /** Completed items, in completion order. */
  readonly items: ReadonlyArray<TurnItem>;
}

const turnText = ({ turn, items }: TranscriptTurn) => {
  const ordered = items.reduce<Array<TurnItem>>((placed, item) => placeItem(placed, item), []);
  const lines = ordered.flatMap((item) => itemLine(item) ?? []);

  return [
    `## Turn ${turn.index + 1} · ${turn.status} · started ${turn.startedAt}`,
    `Prompt: ${clip(turn.prompt)}`,
    ...lines,
  ].join("\n");
};

/** Newest Turns win the budget; an older Turn that doesn't fit is named but left out. */
export const transcriptText = (title: string, turns: ReadonlyArray<TranscriptTurn>) => {
  if (turns.length === 0) return `# ${title}\nNo Turns yet.`;

  const kept: Array<string> = [];
  let used = 0;

  for (const entry of [...turns].reverse()) {
    const text = turnText(entry);

    if (used + text.length > TRANSCRIPT_LIMIT && kept.length > 0) {
      kept.push(`## Turn ${entry.turn.index + 1} and earlier: left out (too long). Use since.`);
      break;
    }

    kept.push(text.length > TRANSCRIPT_LIMIT ? clip(text, TRANSCRIPT_LIMIT) : text);
    used += text.length;
  }

  return [`# ${title}`, ...kept.reverse()].join("\n\n");
};
