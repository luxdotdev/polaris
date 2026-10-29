/**
 * The reviewer's answer to a follow-up, read from its session as the Desktop App reads it
 * (apps/desktop risk/model/answer.ts): one fenced JSON document whose `answer` is Markdown; prose
 * outside it shows only when there is no document. While it works, the step it's on.
 */
import { type FencedBlock, fencedBlocks, TurnItem } from "@polaris/protocol";
import { Option, Schema } from "effect";
import type { TurnEntry } from "../../thread/fold.ts";
import { toolLabel } from "../../thread/steps.ts";

const Reply = Schema.fromJsonString(
  Schema.Struct({ answer: Schema.optional(Schema.NullOr(Schema.String)) })
);

const decodeReply = Schema.decodeUnknownOption(Reply);

const isDocument = (block: FencedBlock) => block.lang === "json" || block.lang === "";

export type Answer =
  /** `step` is what it's doing ("Read deploy/prototype.yml"), or null between steps. */
  | { readonly kind: "thinking"; readonly step: string | null }
  | { readonly kind: "answered"; readonly text: string }
  | { readonly kind: "failed"; readonly text: string };

/** The answer in an assistant message, or null when it holds no reply document. */
export const answerIn = (message: string): string | null => {
  for (const block of fencedBlocks(message).filter(isDocument).reverse()) {
    const reply = decodeReply(block.body);

    if (Option.isSome(reply)) return reply.value.answer ?? "";
  }

  return null;
};

const prose = (messages: ReadonlyArray<string>) =>
  messages
    .flatMap((m) => {
      const documents = fencedBlocks(m).filter(isDocument).reverse();
      const text = documents.reduce((t, b) => t.slice(0, b.start) + t.slice(b.end), m).trim();

      return text === "" ? [] : [text];
    })
    .join("\n\n");

const isMessage = TurnItem.guards.AssistantMessage;

const isTool = TurnItem.guards.ToolCall;

const messagesOf = (entry: TurnEntry): ReadonlyArray<string> => {
  const done = entry.items.filter(isMessage).map((m) => m.text);
  const streaming = entry.streaming.map((s) => s.text);

  return [...done, ...streaming];
};

const stepOf = (entry: TurnEntry): string | null => {
  const running = [...entry.live].reverse().find(isTool);

  return running === undefined ? null : toolLabel(running);
};

export const answerOf = (entry: TurnEntry | null): Answer => {
  if (entry === null) return { kind: "thinking", step: null };

  if (entry.turn.status === "working") return { kind: "thinking", step: stepOf(entry) };

  const messages = messagesOf(entry);

  const answer = [...messages]
    .reverse()
    .map(answerIn)
    .find((a) => a !== null);

  if (answer !== undefined && answer !== null && answer.trim() !== "")
    return { kind: "answered", text: answer.trim() };
  const text = prose(messages);

  if (entry.turn.status === "completed")
    return { kind: "answered", text: text === "" ? "No answer; the review is unchanged." : text };

  return {
    kind: "failed",
    text:
      entry.turn.status === "interrupted"
        ? "The reviewer was stopped."
        : "The reviewer couldn’t answer.",
  };
};
