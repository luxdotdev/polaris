import { describe, expect, test } from "bun:test";
import { WorkspaceId } from "@polaris/protocol";
import { footerOf, type InlineRequest, isAnswer, landed, patchProblem } from "./card.ts";

const content = "a\nawait sleep(BASE);\nb\n";

const from = content.indexOf("await");

const to = content.indexOf("\nb");

const request: InlineRequest = {
  workspaceId: WorkspaceId.make("w"),
  path: "/code/w/a.ts",
  content,
  selection: { from, to },
  prompt: "back off",
  harness: "claude",
  model: null,
  effort: null,
};

const running = {
  kind: "running" as const,
  request,
  version: 3,
  startedAt: 0,
  text: "",
};

const patch = {
  summary: "Exponential backoff",
  replacements: [{ from, to, text: "const d = 2 ** n;\nawait sleep(d);" }],
};

describe("patchProblem", () => {
  test("accepts a patch inside the selection", () => {
    expect(patchProblem(request, patch)).toBeNull();
  });

  test("refuses one outside it", () => {
    expect(
      patchProblem(request, { summary: "x", replacements: [{ from: 0, to: 1, text: "" }] })
    ).toBe("The proposal reached outside the selected lines");
  });
});

describe("landed", () => {
  test("a proposal for the buffer as sent", () => {
    expect(landed(running, patch, 4000, 3)).toEqual({
      kind: "proposed",
      request,
      patch,
      thoughtMs: 4000,
    });
  });

  test("stale once the buffer moved on, or the card closed", () => {
    expect(landed(running, patch, 4000, 4).kind).toBe("stale");
    expect(landed(running, patch, 4000, null).kind).toBe("stale");
  });

  test("failed when the patch doesn't fit", () => {
    const bad = { summary: "x", replacements: [{ from: 0, to: 999, text: "" }] };

    expect(landed(running, bad, 1, 3).kind).toBe("failed");
  });
});

describe("footer", () => {
  test("says what changed and how long it thought", () => {
    expect(footerOf({ kind: "proposed", request, patch, thoughtMs: 4200 })).toEqual({
      changes: "1 change",
      added: 2,
      removed: 1,
      thought: "Thought for 4s",
    });
  });

  test("no replacements is an answer", () => {
    expect(
      isAnswer({
        kind: "proposed",
        request,
        patch: { summary: "It retries", replacements: [] },
        thoughtMs: 1,
      })
    ).toBe(true);
  });
});
