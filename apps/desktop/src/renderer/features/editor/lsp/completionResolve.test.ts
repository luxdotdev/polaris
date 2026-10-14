import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeAll, describe, expect, test } from "bun:test";
import { Predicate } from "effect";
import { completionSource } from "./codemirror.ts";
import { TS_IMPORT_ITEM, TS_IMPORT_RESOLVED } from "./completionFixtures.testing.ts";
import { LanguageFeatures } from "./features.ts";
import { CompletionResult, decodePayload } from "./payloads.ts";

const TYPED = "const label = hostLa";

const IMPORTED = `import { hostLabel } from "./hosts";\n\nconst label = hostLabel\n`;

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

/** tsserver offering `hostLabel` from `./hosts`; resolve answers when `answer` settles. */
type Resolved = typeof TS_IMPORT_RESOLVED;

/** A short stand-in for SETTLE_MS, how long accepting waits for the resolved item. */
const SETTLE = 50;

const fixture = async (answer: Promise<Resolved>) => {
  const view = new EditorView({
    state: EditorState.create({ doc: `${TYPED}\n` }),
    parent: document.body,
  });

  const initial = { uri: "file:///project/imp.ts", version: 1, doc: view.state.doc };
  let current = true;
  let resolves = 0;

  const provider = {
    context: { providerId: "typescript-language-server" },
    capabilities: { completionResolve: true },
  };

  const features = {
    options: { buffer: () => initial, providers: () => [provider] },
    requests: { current: () => current },
    completion: async () => [
      {
        provider,
        request: {},
        value: {},
        payload: decodePayload(CompletionResult, [TS_IMPORT_ITEM]),
      },
    ],
    resolve: async () => {
      resolves++;

      return [{ value: { result: await answer } }];
    },
  };

  // SAFETY: a prototype-backed stub; the source reads only the members assigned below.
  const stub = Object.assign(
    Object.create(LanguageFeatures.prototype) as LanguageFeatures,
    features
  );

  const source = completionSource(stub, { propose: () => {} }, undefined, SETTLE);
  const result = await source(new CompletionContext(view.state, TYPED.length, true));
  const option: Completion | undefined = result?.options[0];

  if (!option || !Predicate.isFunction(option.apply)) throw new Error("no option to accept");
  const apply = option.apply;

  return {
    view,
    option,
    accept: () => apply(view, option, result?.from ?? 0, TYPED.length),
    info: () => (Predicate.isFunction(option.info) ? option.info(option) : null),
    resolves: () => resolves,
    stale: () => {
      current = false;
    },
  };
};

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("accepting a completion applies the resolved item", () => {
  test("the row shows the module; resolve brings tsserver's auto-import edit", async () => {
    const f = await fixture(Promise.resolve(TS_IMPORT_RESOLVED));

    expect(f.option.detail).toBe("./hosts");
    await f.info();
    f.accept();

    expect(f.view.state.doc.toString()).toBe(IMPORTED);
    expect(f.resolves()).toBe(1);
    f.view.destroy();
  });

  test("accepted before resolve returns: waits for it, then imports", async () => {
    let answer = (_value: Resolved) => {};

    const f = await fixture(new Promise<Resolved>((resolve) => (answer = resolve)));

    f.accept();
    expect(f.view.state.doc.toString()).toBe(`${TYPED}\n`);
    answer(TS_IMPORT_RESOLVED);
    await settle(10);

    expect(f.view.state.doc.toString()).toBe(IMPORTED);
    f.view.destroy();
  });

  test("no answer within the bound: the unresolved item, without the import", async () => {
    const f = await fixture(new Promise<Resolved>(() => {}));

    f.accept();
    await settle(SETTLE + 50);

    expect(f.view.state.doc.toString()).toBe("const label = hostLabel\n");
    f.view.destroy();
  });

  test("text typed or a fence lost while waiting: nothing is applied", async () => {
    let answer = (_value: Resolved) => {};

    const typed = await fixture(new Promise<Resolved>((resolve) => (answer = resolve)));

    typed.accept();
    typed.view.dispatch({ changes: { from: TYPED.length, insert: "b" } });
    answer(TS_IMPORT_RESOLVED);
    await settle(10);
    expect(typed.view.state.doc.toString()).toBe(`${TYPED}b\n`);
    typed.view.destroy();

    const fenced = await fixture(new Promise<Resolved>((resolve) => (answer = resolve)));

    fenced.accept();
    fenced.stale();
    answer(TS_IMPORT_RESOLVED);
    await settle(10);
    expect(fenced.view.state.doc.toString()).toBe(`${TYPED}\n`);
    fenced.view.destroy();
  });
});
