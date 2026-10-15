import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { fixture, provider, uri } from "./adapters.testing.ts";
import { LanguageDiagnosticFeed } from "./diagnostics.ts";
import { languageImportSource } from "./imports.ts";
import type { LanguageProvider } from "./types.ts";

const DOC = "const ok = hostCanServe(16);\nconst n = 1;\n";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Item = (typeof P.LanguageDiagnostic.Type)["code"];

const item = (line: number, from: number, to: number, code: Item, message: string) => ({
  range: { start: { line, character: from }, end: { line, character: to } },
  severity: 1 as const,
  source: "ts",
  code,
  message,
  tags: [],
});

const UNRESOLVED = item(0, 11, 23, 2304, "Cannot find name 'hostCanServe'.");

const diagnostics = (p: LanguageProvider, items: ReturnType<typeof item>[]) =>
  P.LanguageDiagnostics.make({
    context: p.context,
    providerId: p.context.providerId,
    generation: 1,
    uri,
    version: 1,
    freshness: "versioned",
    kind: "full",
    resultId: null,
    previousResultId: null,
    items,
    truncated: false,
  });

const IMPORT = 'import { hostCanServe } from "./probe.ts";\n';

const ADD_IMPORT = [
  {
    title: 'Add import from "./probe.ts"',
    kind: "quickfix",
    edit: {
      changes: {
        [uri]: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: IMPORT,
          },
        ],
      },
    },
  },
];

const setup = () => {
  const f = fixture(1000, 32, DOC);
  const p = provider("first");
  f.setProviders([p]);

  const feed = new LanguageDiagnosticFeed(f.features.requests, () => {});

  const source = languageImportSource({
    features: f.features,
    diagnostics: feed,
    read: () => f.buffer,
  });

  return { f, p, feed, source };
};

test("an unresolved name in the changed range asks for its quick fixes once diagnostics arrive", async () => {
  const { f, p, feed, source } = setup();
  const found = source.find({ from: 0, to: 28 }, new AbortController().signal);
  await flush();
  expect(f.pending).toHaveLength(0);

  feed.receive(
    p,
    diagnostics(p, [item(1, 6, 7, 6133, "'n' is declared but never used."), UNRESOLVED])
  );
  await flush();
  expect(f.pending).toHaveLength(1);
  const request = f.pending[0]!.request;
  expect(request.method).toBe("textDocument/codeAction");
  expect(request.params).toMatchObject({
    range: UNRESOLVED.range,
    context: { only: ["quickfix"], diagnostics: [{ code: 2304, range: UNRESOLVED.range }] },
  });

  f.reply(0, ADD_IMPORT);
  const candidate = await found;
  expect(candidate?.title).toBe('Add import from "./probe.ts"');
  expect(candidate?.hunks).toEqual([{ from: 0, to: 0, text: IMPORT }]);
  expect(candidate?.current()).toBe(true);
  f.change();
  expect(candidate?.current()).toBe(false);
});

test.each([
  [
    "a diagnostic that is not an unresolved name",
    [item(0, 6, 8, 6133, "'ok' is declared but never used.")],
  ],
  ["an unresolved name outside the changed range", [item(1, 6, 7, 2304, "Cannot find name 'n'.")]],
  ["no diagnostics at all", []],
])("%s asks the server for nothing", async (_name, items) => {
  const { f, p, feed, source } = setup();
  const found = source.find({ from: 0, to: 28 }, new AbortController().signal);
  feed.receive(p, diagnostics(p, items));
  expect(await found).toBeNull();
  expect(f.pending).toHaveLength(0);
});

test("a lookup aborted while it waits for diagnostics settles with nothing", async () => {
  const { f, source } = setup();
  const controller = new AbortController();
  const found = source.find({ from: 0, to: 28 }, controller.signal);
  controller.abort();
  expect(await found).toBeNull();
  expect(f.pending).toHaveLength(0);
});
