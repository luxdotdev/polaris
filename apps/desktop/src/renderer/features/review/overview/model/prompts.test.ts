import { expect, test } from "bun:test";
import { promptRows, promptTurns } from "./prompts.ts";

test("prompts are numbered as Turns are shown; a Harness-started Turn adds its files", () => {
  const turns = promptTurns([
    { number: 7, prompt: "Split the store", turns: [{ index: 9 }, { index: 10 }] },
    { number: 8, prompt: "Now the tests", turns: [{ index: 11 }] },
  ]);

  const prompts = [
    { turnIndex: 9, prompt: "Split the store", files: 2 },
    { turnIndex: 10, prompt: "[Background task continuation]", files: 1 },
    { turnIndex: 11, prompt: "Now the tests", files: 3 },
  ];

  expect(promptRows(prompts, turns)).toEqual([
    { number: 8, prompt: "Now the tests", files: 3 },
    { number: 7, prompt: "Split the store", files: 3 },
  ]);
});
