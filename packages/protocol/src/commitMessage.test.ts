import { expect, test } from "bun:test";
import { Schema } from "effect";
import {
  CommitMessage,
  CommitMessageError,
  CommitMessageStreamItem,
  commitMessageText,
} from "./commitMessage.ts";

const roundTrip = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: S["Type"]) =>
  Schema.decodeUnknownSync(schema)(Schema.encodeUnknownSync(schema)(value));

test("a suggested message and its errors survive the wire", () => {
  const item = CommitMessageStreamItem.cases.Suggested.make({
    message: { subject: "feat: add", body: "" },
    truncated: true,
    thoughtMs: 12,
  });

  expect(roundTrip(CommitMessageStreamItem, item)).toEqual(item);

  const error = new CommitMessageError({ reason: "needs-sign-in", message: "Sign in" });

  expect(roundTrip(CommitMessageError, error)).toMatchObject({ reason: "needs-sign-in" });
});

test("a message needs a subject; the body may be empty", () => {
  expect(() => Schema.decodeUnknownSync(CommitMessage)({ subject: "", body: "" })).toThrow();
  expect(Schema.decodeUnknownSync(CommitMessage)({ subject: "Fix", body: "" })).toEqual({
    subject: "Fix",
    body: "",
  });
});

test("the Commit box's text is the subject, a blank line, then the body", () => {
  expect(commitMessageText({ subject: "Fix", body: "" })).toBe("Fix");
  expect(commitMessageText({ subject: "Fix", body: "Why." })).toBe("Fix\n\nWhy.");
});
