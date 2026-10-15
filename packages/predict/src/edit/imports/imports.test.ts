import { describe, expect, test } from "bun:test";
import {
  type LspCodeAction,
  selectImportFix,
  type UnresolvedName,
  unresolvedInBurst,
} from "./index.ts";

const uri = "file:///workspace/apps/daemon/src/files/trash.ts";

const at = (line: number, character = 0) => ({ line, character });

const insert = (line: number, newText: string) => ({
  range: { start: at(line), end: at(line) },
  newText,
});

// The shape typescript-language-server 6.0.1 returns: an edit plus its no-op apply command.
const tsFix = (
  title: string,
  edits: NonNullable<LspCodeAction["edit"]>,
  commands: unknown[] = []
): LspCodeAction => ({
  title,
  kind: "quickfix",
  command: {
    title,
    command: "_typescript.applyCodeActionCommand",
    arguments: [
      {
        action: {
          fixName: "import",
          description: title,
          changes: [],
          commands,
        },
      },
    ],
  },
  edit: edits,
});

const addImport = (module: string, name: string, preferred = false, line = 5): LspCodeAction => ({
  ...tsFix(`Add import from "${module}"`, {
    documentChanges: [
      { textDocument: { uri }, edits: [insert(line, `import { ${name} } from "${module}";\n`)] },
    ],
  }),
  isPreferred: preferred,
});

const declare = (name: string): LspCodeAction =>
  tsFix(`Add missing function declaration '${name}'`, {
    documentChanges: [{ textDocument: { uri }, edits: [insert(80, `\nfunction ${name}() {}\n`)] }],
  });

const unresolved = (name: string, line: number, actions: LspCodeAction[]): UnresolvedName => ({
  diagnostic: {
    range: { start: at(line, 4), end: at(line, 4 + name.length) },
    message: `Cannot find name '${name}'.`,
    code: 2304,
  },
  actions,
});

const doc = (text = "") => ({ uri, text });

describe("selectImportFix", () => {
  test("offers the server's preferred import over a declaration stub", () => {
    const choice = selectImportFix(doc(), [
      unresolved("childEnv", 19, [
        addImport("../service/childEnv.ts", "childEnv", true),
        declare("childEnv"),
      ]),
    ]);

    expect(choice?.module).toBe("../service/childEnv.ts");
    expect(choice?.edits).toEqual([
      insert(5, 'import { childEnv } from "../service/childEnv.ts";\n'),
    ]);
  });

  test("never offers a declaration stub, even as the only action", () => {
    expect(
      selectImportFix(doc(), [unresolved("x", 3, [{ ...declare("x"), isPreferred: true }])])
    ).toBeNull();
  });

  test("offers nothing when two modules export the name and neither is preferred", () => {
    const name = unresolved("which", 26, [
      addImport("bun", "which", false),
      addImport("../service/userPath.ts", "which", false),
      declare("which"),
    ]);

    expect(selectImportFix(doc(), [name], "spec")).toBeNull();
    expect(selectImportFix(doc(), [name], "module")).toBeNull();
  });

  test("the module rule picks the candidate the file already imports from", () => {
    const name = unresolved("watchGit", 40, [
      addImport("./watch.ts", "watchGit", false),
      addImport("./other.ts", "watchGit", false),
    ]);

    const text = 'import { GitWatch } from "./watch.ts";\n';
    expect(selectImportFix(doc(text), [name], "spec")).toBeNull();
    expect(selectImportFix(doc(text), [name], "module")?.module).toBe("./watch.ts");
  });

  test("the module rule picks the one module that resolves every name in the burst", () => {
    const names = ["useChangeOpener", "useShownDiff", "selectedPath"].map((n, i) =>
      unresolved(n, 160 + i, [
        addImport("../../diff/index.ts", n, false),
        addImport(`../../diff/${n}.ts`, n, false),
      ])
    );

    expect(selectImportFix(doc(), names, "module")?.module).toBe("../../diff/index.ts");
  });

  test("the module rule prefers the package over a path into another package's src", () => {
    const own = "file:///workspace/apps/desktop/src/renderer/data/store.ts";

    const name: UnresolvedName = {
      ...unresolved("GitTracking", 23, []),
      actions: ["@polaris/protocol", "../../../../../packages/protocol/src/git.ts"].map(
        (module) => ({
          title: `Add import from "${module}"`,
          edit: {
            changes: { [own]: [insert(9, `import type { GitTracking } from "${module}";\n`)] },
          },
        })
      ),
    };

    expect(selectImportFix({ uri: own, text: "" }, [name], "module")?.module).toBe(
      "@polaris/protocol"
    );
  });

  test("rejects fixes that touch another file, replace text, or run another command", () => {
    const elsewhere = tsFix('Add import from "./a.ts"', {
      documentChanges: [
        { textDocument: { uri: "file:///workspace/other.ts" }, edits: [insert(0, "x")] },
      ],
    });

    const replaces = tsFix('Update import from "./a.ts"', {
      documentChanges: [
        {
          textDocument: { uri },
          edits: [{ range: { start: at(1), end: at(1, 9) }, newText: "{ a, b }" }],
        },
      ],
    });

    const runs = tsFix(
      'Add import from "./a.ts"',
      { documentChanges: [{ textDocument: { uri }, edits: [insert(0, "x")] }] },
      [{}]
    );

    const creates = {
      title: 'Add import from "./a.ts"',
      edit: { documentChanges: [{ kind: "create", uri: "file:///x" }] },
    };

    for (const action of [elsewhere, replaces, runs, creates])
      expect(
        selectImportFix(doc(), [unresolved("a", 3, [{ ...action, isPreferred: true }])])
      ).toBeNull();
  });

  test("offers the first name in document order that has an import", () => {
    const choice = selectImportFix(doc(), [
      unresolved("usePullCommands", 107, [addImport("./pullMenu.tsx", "usePullCommands", true)]),
      unresolved("pullUrlOf", 105, [addImport("./pullMenu.tsx", "pullUrlOf", true)]),
    ]);

    expect(choice?.diagnostic.message).toBe("Cannot find name 'pullUrlOf'.");
  });
});

describe("unresolvedInBurst", () => {
  const diagnostic = (name: string, line: number, code = 2304) => ({
    ...unresolved(name, line, []).diagnostic,
    code,
  });

  test("keeps unresolved names on the burst's lines or written by the burst, nothing else", () => {
    const burst = { lines: new Set([19]), names: new Set(["REVIEWER_MARKER"]) };

    const kept = unresolvedInBurst(
      [
        diagnostic("childEnv", 19),
        diagnostic("REVIEWER_MARKER", 72),
        diagnostic("elsewhere", 90),
        diagnostic("childEnv", 19, 2322),
      ],
      burst
    );

    expect(kept.map((d) => [d.range.start.line, d.code])).toEqual([
      [19, 2304],
      [72, 2304],
    ]);
  });
});
