import { describe, expect, spyOn, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { LanguageSupport, StreamLanguage, ensureSyntaxTree } from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import {
  LANGUAGES,
  LANGUAGE_IDS,
  LANGUAGE_NAMES,
  languageByName,
  languageFor,
  type LanguageId,
} from "./language.ts";
import {
  createGrammarLoader,
  fenceLanguageId,
  fencedLanguages,
  loadLanguage,
  type GrammarId,
  type GrammarLoader,
} from "../cm/languages.ts";

const samples: Readonly<Record<Exclude<LanguageId, "plain">, string>> = {
  typescript: "const count: number = 3;",
  tsx: 'const view = <div title="hello" />;',
  javascript: 'const name = "hello";',
  jsx: 'const view = <div title="hello" />;',
  json: '{"name": true}',
  css: ".item { color: red; }",
  html: '<div title="hello">hello</div>',
  markdown: "# Title\n\n**strong** and ~~removed~~",
  python: 'def greet():\n  return "hello"',
  rust: "fn main() { let count = 3; }",
  go: "package main\nfunc main() {}",
  gomod: "module example.test/demo\ngo 1.24\nrequire example.test/lib v1.2.3",
  gowork: "go 1.24\nuse ./demo",
  yaml: 'name: "demo"\non: push\njobs:\n  build: true',
  toml: '[project]\nname = "hello"',
  sql: "SELECT * FROM users WHERE id = 1;",
  shell: '#!/bin/bash\necho "$HOME"',
  dotenv: '# fixture\nexport NAME="demo"\nPORT=3000',
  prisma: "model User {\n  id Int @id @default(autoincrement())\n  name String?\n}",
  java: 'class Demo { String name = "hello"; }',
  php: '<?php echo "hello"; ?>',
  lua: 'local name = "hello"\nreturn name',
  c: "int main() { return 0; }",
  cpp: "class Demo { public: int count = 1; };",
  csharp: 'class Demo { string name = "hello"; }',
  ruby: 'def greet\n  puts "hello"\nend',
  xml: '<item name="hello" />',
  dockerfile: 'FROM alpine:3\nRUN echo "hello"',
  ini: "[project]\nname=hello\n# comment",
  diff: "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new",
};

const spansFor = async (id: LanguageId, doc: string) => {
  const state = EditorState.create({ doc, extensions: await loadLanguage(id) });
  const tree = ensureSyntaxTree(state, doc.length, 1000);
  const spans: Array<{ text: string; classes: string }> = [];

  if (tree !== null)
    highlightTree(tree, classHighlighter, (from, to, classes) =>
      spans.push({ text: doc.slice(from, to), classes })
    );

  return spans;
};

describe("local language associations", () => {
  test("every advertised extension and filename resolves, including the managed catalog", () => {
    for (const id of LANGUAGE_IDS) {
      expect(LANGUAGE_NAMES[id]).toBe(LANGUAGES[id].name);
      expect(languageByName(LANGUAGES[id].name)).toBe(id);

      for (const extension of LANGUAGES[id].extensions)
        expect(languageFor(`/fixture/file.${extension}`)).toBe(id);

      for (const filename of LANGUAGES[id].filenames)
        expect(languageFor(`/fixture/${filename}`)).toBe(id);
    }

    expect(LANGUAGES.tsx.documentLanguageId).toBe("typescriptreact");
    expect(LANGUAGES.jsx.documentLanguageId).toBe("javascriptreact");
    expect(LANGUAGES.shell.documentLanguageId).toBe("shellscript");
  });

  test("dotenv variants are assignments; envrc stays executable shell", () => {
    for (const name of [".env", ".env.local", ".env.example", ".env.production.local", "app.env"])
      expect(languageFor(`/fixture/${name}`)).toBe("dotenv");
    expect(languageFor("/fixture/.envrc")).toBe("shell");
    expect(languageFor("/fixture/.envrc.local")).toBe("plain");
  });

  test("case, paths, named files, shebangs and plain fallback", () => {
    expect(languageFor("C:\\fixture\\SCHEMA.PRISMA")).toBe("prisma");
    expect(languageFor("/fixture/Dockerfile.dev")).toBe("dockerfile");
    expect(languageFor("/fixture/action", "#!/usr/bin/env -S python3 -u")).toBe("python");
    expect(languageFor("/fixture/action", "#!/usr/bin/env bash")).toBe("shell");
    expect(languageFor("/fixture/action", "#!/usr/bin/env node")).toBe("javascript");
    expect(languageFor("/fixture/file.md", "#!/bin/bash")).toBe("markdown");
    expect(languageFor("/fixture/unknown.xyz", "echo python")).toBe("plain");
    expect(languageFor("/fixture/.unknown")).toBe("plain");
    expect(languageFor("/fixture/no-extension")).toBe("plain");
  });
});

describe("lazy grammars", () => {
  test("plain text never needs a grammar", async () => {
    expect(await loadLanguage("plain")).toEqual([]);
  });

  test("each advertised grammar parses and produces syntax spans locally", async () => {
    for (const [name, doc] of Object.entries(samples)) {
      const id = languageByName(name);
      expect(id).toBeDefined();
      expect((await spansFor(id ?? "plain", doc)).length, name).toBeGreaterThan(0);
    }
  });

  test("dotenv quoted multiline values, escapes, comments and interpolation", async () => {
    const spans = await spansFor(
      "dotenv",
      'NAME="line one\nline \\"two\\""\nURL=${HOST} # fixture'
    );

    expect(
      spans.some((span) => span.classes.includes("tok-string") && span.text.includes("line one"))
    ).toBe(true);
    expect(
      spans.some((span) => span.classes.includes("tok-comment") && span.text.includes("fixture"))
    ).toBe(true);
    expect(
      spans.some((span) => span.classes.includes("tok-variableName") && span.text === "${HOST}")
    ).toBe(true);
  });

  test("Prisma blocks, native types, attributes, calls and comments", async () => {
    const spans = await spansFor(
      "prisma",
      'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n/* note */\nmodel User {\n id Int @id @default(autoincrement())\n amount Decimal @db.Decimal(10, 2)\n}'
    );

    for (const classes of [
      "tok-keyword",
      "tok-typeName",
      "tok-comment",
      "tok-string",
      "tok-number",
    ])
      expect(
        spans.some((span) => span.classes.includes(classes)),
        classes
      ).toBe(true);
  });

  test("descriptions stay unloaded until a fence asks for them; aliases are exact", async () => {
    const descriptions = await fencedLanguages();
    expect(descriptions.every((description) => description.support === undefined)).toBe(true);
    expect(fenceLanguageId("ts title=demo")).toBe("typescript");
    expect(fenceLanguageId("github-actions")).toBe("yaml");
    expect(fenceLanguageId("not-java")).toBeUndefined();
    const prisma = descriptions.find((description) => description.name === "Prisma");
    await prisma?.load();
    expect(prisma?.support).toBeInstanceOf(LanguageSupport);
    expect(descriptions.filter((description) => description.support !== undefined)).toHaveLength(1);
  });

  test("concurrent loads share work, failures fall back and retry without eager loading", async () => {
    let requests = 0;

    const support = new LanguageSupport(
      StreamLanguage.define({
        token: (stream) => {
          stream.skipToEnd();

          return null;
        },
      })
    );

    const loader: GrammarLoader = async () => {
      requests++;

      if (requests === 1) throw new Error("synthetic import failure");

      return support;
    };

    // SAFETY: every non-plain LanguageId is present once in this injected loader record.
    const loaders = Object.fromEntries(
      LANGUAGE_IDS.filter((id) => id !== "plain").map((id) => [id, loader])
    ) as Record<GrammarId, GrammarLoader>;

    const load = createGrammarLoader(loaders);
    const warning = spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(requests).toBe(0);
      const first = load("prisma");
      expect(load("prisma")).toBe(first);
      expect(await first).toBeNull();
      expect(await load("prisma")).toBe(support);
      expect(await load("prisma")).toBe(support);
      expect(requests).toBe(2);
    } finally {
      warning.mockRestore();
    }
  });
});
