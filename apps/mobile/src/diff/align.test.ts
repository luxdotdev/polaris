import { describe, expect, test } from "bun:test";
import { hunkLines, hunkPairs, type Line } from "../review/diffRows.ts";
import { parsePatch } from "../review/patch.ts";
import { alignChange, MAX_CHANGE_EDITS, segments } from "./align.ts";
import { tokenize } from "./tokenize.ts";

const patch = [
  "diff --git a/src/artifact/upload.ts b/src/artifact/upload.ts",
  "--- a/src/artifact/upload.ts",
  "+++ b/src/artifact/upload.ts",
  "@@ -36,5 +36,8 @@ upload()",
  ' import { put } from "./store";',
  "-export async function upload(req: Request) {",
  "+export async function upload(req: Request, limit = MAX_BYTES) {",
  "   const id = crypto.randomUUID();",
  "-  const body = await req.text();",
  "+  const body = await req.arrayBuffer();",
  "+  if (body.byteLength > limit) {",
  '+    return new Response("Artifact is larger than the upload limit", { status: 413 });',
  "+  }",
  "   await put(id, body);",
  "",
].join("\n");

const file = parsePatch(patch)[0];

const hunk = file?.hunks[0];

if (file === undefined || hunk === undefined) throw new Error("the fixture has one hunk");

/** Each emphasised run as its text, so a test reads what a reader would see marked. */
const marked = (line: Line | null) =>
  line === null
    ? null
    : segments(line.text, line.emphasis).flatMap((s) => (s.marked ? [s.text] : []));

const text = (source: string, path = "a.ts") =>
  tokenize(source, path).map((t) => [source.slice(t.start, t.end), t.kind]);

describe("the light tokenizer", () => {
  test("splits code into words, strings, comments and single marks", () => {
    expect(text('const s = "a \\" b"; // done')).toEqual([
      ["const", "keyword"],
      ["s", "identifier"],
      ["=", "punctuation"],
      ['"a \\" b"', "string"],
      [";", "punctuation"],
      ["// done", "comment"],
    ]);
  });

  test("reads # as a comment only where the language says so", () => {
    expect(text("x = 1 # note", "run.py").at(-1)).toEqual(["# note", "comment"]);
    expect(text("color: #fff;", "a.css")).toEqual([
      ["color", "identifier"],
      [":", "punctuation"],
      ["#", "punctuation"],
      ["fff", "identifier"],
      [";", "punctuation"],
    ]);
  });
});

describe("token emphasis", () => {
  test("a renamed call marks only the old and new names", () => {
    const lines = hunkLines(file, hunk);
    const body = lines.filter((l) => l.text.includes("const body"));

    expect(body.map(marked)).toEqual([["text"], ["arrayBuffer"]]);
  });

  test("an insertion within a line marks only the new tokens, and nothing on the old line", () => {
    const lines = hunkLines(file, hunk);
    const signature = lines.filter((l) => l.text.includes("function upload"));

    expect(signature.map(marked)).toEqual([[], [", limit = MAX_BYTES"]]);
  });

  test("lines the change adds whole are not marked token by token", () => {
    const added = hunkLines(file, hunk).filter((l) => l.line === "add" && (l.newNumber ?? 0) >= 40);

    expect(added.map(marked)).toEqual([[], [], []]);
  });

  test("a change in spacing alone marks nothing", () => {
    const rows = alignChange(["  return a+b;"], ["  return a + b;"], "a.ts");

    expect(rows.map((r) => [r.kind, r.removed, r.added])).toEqual([["equal", [], []]]);
  });

  test("a change too large to diff by tokens keeps plain pairs instead of failing", () => {
    const many = (prefix: string) =>
      Array.from({ length: MAX_CHANGE_EDITS + 1 }, (_, i) => `${prefix}${i}`);

    const rows = alignChange(many("a"), many("b").slice(0, MAX_CHANGE_EDITS), "a.ts");

    expect(rows.length).toBe(MAX_CHANGE_EDITS + 1);
    expect(rows.every((r) => r.removed.length === 0 && r.added.length === 0)).toBe(true);
    expect(rows.at(-1)).toMatchObject({ kind: "removed", new: null });
  });
});

describe("split alignment", () => {
  test("pairs each change's lines side by side and leaves the new side's extra lines alone", () => {
    const pairs = hunkPairs(file, hunk).map((p) => [
      p.old?.oldNumber ?? null,
      p.new?.newNumber ?? null,
    ]);

    expect(pairs).toEqual([
      [36, 36],
      [37, 37],
      [38, 38],
      [39, 39],
      [null, 40],
      [null, 41],
      [null, 42],
      [40, 43],
    ]);
  });
});

describe("segments", () => {
  test("cuts a line at its spans and keeps every character once", () => {
    const parts = segments("await req.text();", [{ start: 10, end: 14 }]);

    expect(parts).toEqual([
      { text: "await req.", marked: false },
      { text: "text", marked: true },
      { text: "();", marked: false },
    ]);
  });
});
