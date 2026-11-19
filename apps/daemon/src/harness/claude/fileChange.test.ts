/**
 * Claude Code's file tools through the real translator: recorded Edit and Write calls
 * (`fixtures/file-tools.json`), their input streamed in chunks the way the SDK sends it.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type FilePatch, TurnId, TurnItem } from "@polaris/protocol";
import { HarnessEvent } from "../HarnessDriver.ts";
import { type ReadPrevious, readPreviousFile } from "./fileChange.ts";
import { ClaudeTranslator } from "./translate.ts";
import recordedTools from "./fixtures/file-tools.json";

type FileChange = Extract<TurnItem, { readonly _tag: "FileChange" }>;

/** A frame in the SDK's wire shape, from its JSON. */
const frame = (json: string): SDKMessage => {
  // SAFETY: every frame below is built in the SDK's wire shape.
  const message = JSON.parse(json) as SDKMessage;

  return message;
};

const stream = (event: string) =>
  frame(`{"type":"stream_event","parent_tool_use_id":null,"event":${event}}`);

/** The assistant frame of one tool call, `input` its JSON. */
const toolUse = (id: string, name: string, input: string) =>
  frame(
    `{"type":"assistant","parent_tool_use_id":null,"message":{"id":"m1","content":[{"type":"tool_use","id":"${id}","name":"${name}","input":${input}}],"usage":{"input_tokens":1,"output_tokens":1}}}`
  );

/** The user frame of one tool result, `result` its structured `tool_use_result` JSON. */
const toolResult = (id: string, result: string) =>
  frame(
    `{"type":"user","parent_tool_use_id":null,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"${id}","content":"ok"}]},"tool_use_result":${result}}`
  );

/** The tool call's input JSON, streamed in `size`-character chunks as `input_json_delta`s. */
const streamedInput = (id: string, name: string, json: string, size: number) => {
  const chunks = Array.from({ length: Math.ceil(json.length / size) }, (_, i) =>
    json.slice(i * size, (i + 1) * size)
  );

  return [
    stream(`{"type":"message_start","message":{"id":"m1"}}`),
    stream(
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id, name, input: {} },
      })
    ),
    ...chunks.map((partial_json) =>
      stream(
        JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json },
        })
      )
    ),
    stream(`{"type":"content_block_stop","index":0}`),
  ];
};

const run = (frames: ReadonlyArray<SDKMessage>, readPrevious?: ReadPrevious) => {
  const translator = new ClaudeTranslator("/repo", null, undefined, readPrevious);
  translator.beginTurn(TurnId.make("t1"));

  return frames.map((f) => translator.onMessage(f));
};

const fileItems = (events: ReadonlyArray<HarnessEvent>): Array<FileChange> =>
  events.flatMap((e) =>
    (HarnessEvent.$is("ItemUpdated")(e) || HarnessEvent.$is("ItemCompleted")(e)) &&
    TurnItem.guards.FileChange(e.item)
      ? [e.item]
      : []
  );

const patchOf = (item: FileChange | undefined): FilePatch | undefined => item?.changes[0]?.patch;

const { edit, write } = recordedTools;

const json = JSON.stringify;

describe("a streamed file tool call", () => {
  test("shows one Writing item once its path has streamed, then the patch with the full input", () => {
    const frames = [
      ...streamedInput("w1", "Write", json(write.input), 7),
      toolUse("w1", "Write", json(write.input)),
      toolResult("w1", json(write.result)),
    ];

    const perFrame = run(frames, () => write.result.originalFile).map(fileItems);
    const writing = perFrame.flat().filter((item) => item.writing === true);

    expect(writing).toEqual([
      TurnItem.cases.FileChange.make({
        id: "w1",
        changes: [{ path: "/repo/apps/desktop/scripts/test-preload.ts", kind: "modify" }],
        status: "running",
        writing: true,
      }),
    ]);

    const [running] = perFrame.at(-2) ?? [];

    expect(running?.writing).toBeUndefined();
    expect(patchOf(running)).toMatchObject({ added: 17, removed: 2, truncated: false });
  });

  test("a file tool whose path never streams shows no Writing item", () => {
    const events = run(streamedInput("e1", "Edit", `{"old_string":"a","new_string":"b"}`, 5));

    expect(events.flat()).toEqual([]);
  });
});

describe("file tool patches", () => {
  test("a recorded Edit takes Claude Code's own hunks, with the file's line numbers", () => {
    const events = run([
      toolUse("e1", "Edit", json(edit.input)),
      toolResult("e1", json(edit.result)),
    ]);

    const [running, completed] = fileItems(events.flat());

    // Running: only the input, so the hunk counts from the edited fragment.
    expect(patchOf(running)?.diff.startsWith("@@ -1,3 +1,7 @@\n")).toBe(true);
    expect(patchOf(completed)?.diff.startsWith("@@ -71,8 +71,12 @@\n")).toBe(true);
    expect(patchOf(completed)).toMatchObject({ added: 5, removed: 1, truncated: false });
  });

  test("a Write over an existing file diffs against what the Daemon read before it ran", () => {
    const events = run(
      [
        toolUse("w1", "Write", json(write.input)),
        toolResult("w1", json({ ...write.result, structuredPatch: [] })),
      ],
      () => write.result.originalFile
    );

    const [running, completed] = fileItems(events.flat());

    expect(running?.changes[0]?.kind).toBe("modify");
    expect(patchOf(completed)).toEqual(patchOf(running));
    expect(patchOf(completed)?.diff).toContain("+import { GlobalRegistrator }");
  });

  test("a Write that creates a file is all additions, and its kind is add", () => {
    const content = "<!doctype html>\n<h1>Hi</h1>\n";
    const input = { file_path: "/repo/index.html", content };

    const events = run(
      [
        toolUse("w1", "Write", json(input)),
        toolResult(
          "w1",
          json({ type: "create", filePath: input.file_path, content, structuredPatch: [] })
        ),
      ],
      () => null
    );

    const items = fileItems(events.flat());

    expect(items.map((item) => item.changes[0]?.kind)).toEqual(["add", "add"]);
    expect(patchOf(items[1])).toEqual({
      diff: "@@ -0,0 +1,2 @@\n+<!doctype html>\n+<h1>Hi</h1>\n",
      added: 2,
      removed: 0,
      truncated: false,
    });
  });

  test("a Write over a file the Daemon can't read has no patch until Claude Code reports one", () => {
    const events = run([
      toolUse("w1", "Write", json(write.input)),
      toolResult("w1", json(write.result)),
    ]);

    const [running, completed] = fileItems(events.flat());

    expect(running?.changes[0]?.patch).toBeUndefined();
    expect(patchOf(completed)).toMatchObject({ added: 17, removed: 2 });
  });

  test("past the cap a Write carries counts only, marked truncated", () => {
    // 1000 lines of 100 characters: past FILE_PATCH_CAP.
    const content = "x".repeat(99).concat("\n").repeat(1000);
    const input = { file_path: "/repo/big.txt", content };
    const [items] = run([toolUse("w1", "Write", json(input))], () => null).map(fileItems);

    expect(patchOf(items?.[0])).toEqual({
      diff: "",
      added: 1000,
      removed: 0,
      truncated: true,
    });
  });

  test("a MultiEdit joins its edits' hunks into one patch of the file", () => {
    const input = {
      file_path: "/repo/a.ts",
      edits: [
        { old_string: "const a = 1;", new_string: "const a = 2;" },
        { old_string: "b()", new_string: "b()\nc()" },
      ],
    };

    const [items] = run([toolUse("m1", "MultiEdit", json(input))]).map(fileItems);

    expect(patchOf(items?.[0])).toEqual({
      diff: "@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n@@ -1 +1,2 @@\n b()\n+c()\n",
      added: 2,
      removed: 1,
      truncated: false,
    });
  });
});

describe("readPreviousFile", () => {
  test("reads a text file, says a missing one is absent, and leaves binary unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "polaris-previous-"));

    try {
      writeFileSync(join(dir, "a.txt"), "hello\n");
      writeFileSync(join(dir, "b.bin"), Buffer.from([0, 1, 2]));
      const read = readPreviousFile(dir);

      expect([read("a.txt"), read("missing.txt"), read("b.bin")]).toEqual([
        "hello\n",
        null,
        undefined,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
