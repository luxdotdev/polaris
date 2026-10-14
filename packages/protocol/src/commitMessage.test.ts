import { expect, test } from "bun:test";
import { Schema } from "effect";
import { CommitMessage, CommitMessageStreamItem, commitMessageText } from "./commitMessage.ts";

test("a suggestion's thinking time is a whole, non-negative number of milliseconds", () => {
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(CommitMessageStreamItem));

  const suggested = (thoughtMs: number) =>
    `{"_tag":"Suggested","message":{"subject":"feat: add","body":""},"truncated":false,"thoughtMs":${thoughtMs}}`;

  expect(decode(suggested(0))).toMatchObject({ thoughtMs: 0 });
  expect(() => decode(suggested(-1))).toThrow();
  expect(() => decode(suggested(1.5))).toThrow();
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
