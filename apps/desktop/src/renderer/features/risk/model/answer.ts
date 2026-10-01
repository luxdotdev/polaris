/**
 * The Reviewer's answer to a follow-up, read from its session: it replies with one fenced
 * JSON document (ENG-222) whose `answer` is Markdown; its findings reach the summary on
 * their own. Prose outside the document is shown only when there is no document.
 */
import { Option, Schema } from "effect";

const Reply = Schema.fromJsonString(
  Schema.Struct({ answer: Schema.optional(Schema.NullOr(Schema.String)) })
);

const decodeReply = Schema.decodeUnknownOption(Reply);

const FENCE = /```(?:json)?\s*\n([\s\S]*?)\n```/g;

export type Answer =
  | { readonly kind: "thinking" }
  | { readonly kind: "answered"; readonly text: string }
  | { readonly kind: "failed"; readonly text: string };

/** The answer in an assistant message, or null when it holds no reply document. */
export const answerIn = (message: string): string | null => {
  const blocks = [...message.matchAll(FENCE)].map((m) => m[1] ?? "");

  for (const block of blocks.toReversed()) {
    const reply = decodeReply(block);

    if (Option.isSome(reply)) return reply.value.answer ?? "";
  }

  return null;
};

export interface TurnSnapshot {
  readonly status: "working" | "completed" | "interrupted" | "failed";
  /** The Turn's assistant messages in order, finished or streaming. */
  readonly messages: ReadonlyArray<string>;
}

const prose = (messages: ReadonlyArray<string>) =>
  messages
    .flatMap((m) => {
      const text = m.replace(FENCE, "").trim();

      return text === "" ? [] : [text];
    })
    .join("\n\n");

export const answerOf = (turn: TurnSnapshot | null): Answer => {
  if (turn === null || turn.status === "working") return { kind: "thinking" };

  const answer = turn.messages
    .toReversed()
    .map(answerIn)
    .find((a) => a !== null);

  if (answer !== undefined && answer !== null && answer.trim() !== "") {
    return { kind: "answered", text: answer.trim() };
  }

  const text = prose(turn.messages);

  if (turn.status === "completed") {
    return { kind: "answered", text: text === "" ? "No answer; the review is unchanged." : text };
  }

  return {
    kind: "failed",
    text:
      turn.status === "interrupted" ? "The reviewer was stopped." : "The reviewer couldn’t answer.",
  };
};
