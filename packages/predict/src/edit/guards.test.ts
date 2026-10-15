import { expect, test } from "bun:test";
import type { EditPredictionRequest } from "@polaris/protocol";
import { request } from "./fixtures.testing.ts";
import { applyEdits } from "./guards.ts";
import { spikeEditOptions } from "./options.ts";
import { editResult as resultWith } from "./result.ts";

// Parsing and revert mechanics, without the hill-climbed guards (hillclimb.test.ts covers those).
const editResult: typeof resultWith = (request, output, elapsed) =>
  resultWith(request, output, elapsed, spikeEditOptions);

const input = (
  buffer: string,
  before: string,
  after: string,
  cursor = buffer.length
): EditPredictionRequest => ({
  ...request,
  format: "sweep-next-edit",
  buffer,
  cursor,
  history: [{ path: request.path, line: 0, before, after }],
});

test("frozen history permits appending at the cursor, but protects the typed prefix", () => {
  const source = input("const result = compute", "", "const result = compute");
  const continuation = editResult(source, "const result = compute(input);");
  expect(applyEdits(source.buffer, continuation.edits)).toBe("const result = compute(input);");
  expect([
    ...new Set(
      editResult(source, "const result = cached(input);").suppressed.map((hunk) => hunk.reason)
    ),
  ]).toEqual(["revert"]);
});

test("a continuation cannot excuse deleting a second copy of an authored line", () => {
  const buffer = "invoke\ninvoke\n";
  const result = editResult(input(buffer, "", "invoke", 6), "invoke();\n");

  expect(result.edits).toEqual([]);
  expect(result.suppressed.length).toBeGreaterThan(0);
  expect(result.suppressed.every((hunk) => hunk.reason === "revert")).toBe(true);
});

test("deleting an unrelated exported definition is suppressed, removing a dead binding is allowed", () => {
  const buffer = "export const healthy = 1;\nuse(newName);";
  expect(
    editResult(input(buffer, "use(oldName);", "use(newName);"), "use(newName);").edits
  ).toEqual([]);

  const dead = input("const oldName = 1;\nuse(newName);", "use(oldName);", "use(newName);");

  expect(applyEdits(dead.buffer, editResult(dead, "use(newName);").edits)).toBe("use(newName);");
});

test("import aliases cannot be redefined by a local declaration", () => {
  const buffer =
    'import { platform as current } from "./platform";\nconst old = detect();\nuse(current());';

  const source = input(buffer, "use(old);", "use(current());");

  const result = editResult(
    source,
    buffer.replace("const old = detect();", "const current = () => detect();")
  );

  expect(result.edits).toEqual([]);
  expect(result.suppressed.length).toBeGreaterThan(0);
});

test("rename propagation preserves another namespace while allowing the recorded substitution", () => {
  const buffer =
    'import { posix, win32 } from "node:path";\nconst first = posix.resolve(a);\nconst second = resolve(b);\nconst windows = win32.resolve(c);';

  const source = input(buffer, "const first = resolve(a);", "const first = posix.resolve(a);");
  const correct = buffer.replace("second = resolve", "second = posix.resolve");
  expect(applyEdits(buffer, editResult(source, correct).edits)).toBe(correct);
  expect(editResult(source, correct.replace("win32.resolve(c)", "posix.resolve(c)")).edits).toEqual(
    []
  );
});

test("a mixed edit may remove an empty line without losing its useful change", () => {
  const buffer = "const x = 1;\n\nconst y = 2;";

  const source: EditPredictionRequest = {
    ...request,
    format: "sweep-next-edit",
    buffer,
    cursor: 10,
  };

  const result = editResult(source, "const x = 3;\nconst y = 2;");
  expect(applyEdits(buffer, result.edits)).toBe("const x = 3;\nconst y = 2;");
});
