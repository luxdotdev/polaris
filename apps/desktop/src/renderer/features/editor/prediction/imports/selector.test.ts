import { expect, test } from "bun:test";
import { type ImportAction, isUnresolvedName, specImportRule } from "./index.ts";

const uri = "file:///p/score.ts";

const document = { uri, version: 3 };

const at = (line: number, character: number) => ({ line, character });

const insert = (text: string, line = 0) => ({
  range: { start: at(line, 0), end: at(line, 0) },
  newText: text,
});

/** TypeScript 7's answer for `hostCanServe(16)` with `./probe.ts` exporting it. */
const addImport = (title = 'Add import from "./probe.ts"', extra: Partial<ImportAction> = {}) => ({
  title,
  kind: "quickfix",
  edit: { changes: { [uri]: [insert('import { hostCanServe } from "./probe.ts";\n')] } },
  ...extra,
});

test.each<[string, ReadonlyArray<ImportAction>, string | null]>([
  ["the only quick fix", [addImport()], 'Add import from "./probe.ts"'],
  [
    "the one preferred among several",
    [
      addImport('Add import from "./a.ts"'),
      addImport('Add import from "./b.ts"', { isPreferred: true }),
    ],
    'Add import from "./b.ts"',
  ],
  ["several, none preferred", [addImport("one"), addImport("two")], null],
  [
    "several preferred",
    [addImport("one", { isPreferred: true }), addImport("two", { isPreferred: true })],
    null,
  ],
  [
    "a disabled fix beside the only enabled one",
    [addImport("off", { disabled: { reason: "no" } }), addImport("on")],
    "on",
  ],
  [
    "a refactor beside the only quick fix",
    [addImport("move", { kind: "refactor.move" }), addImport("fix")],
    "fix",
  ],
])("selects %s", (_name, actions, title) => {
  expect(specImportRule(actions, document)?.title ?? null).toBe(title);
});

test.each<[string, ImportAction]>([
  [
    "edits another file",
    addImport(undefined, {
      edit: {
        changes: {
          [uri]: [insert("import { a } from './a';\n")],
          "file:///p/other.ts": [insert("export {};\n")],
        },
      },
    }),
  ],
  [
    "deletes text",
    addImport(undefined, {
      edit: { changes: { [uri]: [{ range: { start: at(0, 0), end: at(0, 4) }, newText: "" }] } },
    }),
  ],
  [
    "replaces text",
    addImport(undefined, {
      edit: { changes: { [uri]: [{ range: { start: at(0, 0), end: at(0, 4) }, newText: "x" }] } },
    }),
  ],
  ["runs a command too", addImport(undefined, { command: { title: "x", command: "organize" } })],
  ["has no edit", { title: "Add import", kind: "quickfix" }],
  [
    "creates a file",
    addImport(undefined, {
      edit: { documentChanges: [{ kind: "create", uri: "file:///p/new.ts" }] },
    }),
  ],
  [
    "targets another version of this document",
    addImport(undefined, {
      edit: {
        documentChanges: [{ textDocument: { uri, version: 2 }, edits: [insert("import x;\n")] }],
      },
    }),
  ],
])("offers nothing when the one fix %s", (_name, action) => {
  expect(specImportRule([action], document)).toBeNull();
});

test("a fix as documentChanges for this version yields its insertion positions", () => {
  const choice = specImportRule(
    [
      addImport(undefined, {
        edit: {
          documentChanges: [
            { textDocument: { uri, version: 3 }, edits: [insert("import x;\n", 2)] },
          ],
        },
      }),
    ],
    document
  );

  expect(choice?.inserts).toEqual([{ at: at(2, 0), text: "import x;\n" }]);
});

test.each<[string, Parameters<typeof isUnresolvedName>[0], boolean]>([
  ["TypeScript 2304", { code: 2304, message: "Cannot find name 'x'.", severity: 1 }, true],
  ["rust-analyzer E0425", { code: "E0425", message: "cannot find value `x`", severity: 1 }, true],
  [
    "Pyright",
    { code: "reportUndefinedVariable", message: '"x" is not defined', severity: 1 },
    true,
  ],
  ["gopls by message", { code: null, message: "undefined: strings", severity: 1 }, true],
  [
    "an unused name",
    { code: 6133, message: "'x' is declared but never used.", severity: 1 },
    false,
  ],
  ["a type error", { code: 2322, message: "Type 'string' is not assignable", severity: 1 }, false],
  ["a hint", { code: 2304, message: "Cannot find name 'x'.", severity: 4 }, false],
])("%s is an unresolved name: %p", (_name, diagnostic, expected) => {
  expect(isUnresolvedName(diagnostic)).toBe(expected);
});
