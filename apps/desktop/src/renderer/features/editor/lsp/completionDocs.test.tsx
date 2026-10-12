import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Predicate } from "effect";
import { completionSource } from "./codemirror.ts";
import {
  CSS_DISPLAY,
  CSS_ITEMS,
  CSS_PLAINTEXT_ITEMS,
  PYRIGHT_DUMPS_RESOLVED,
  PYRIGHT_ITEMS,
  TS_APPEND_RESOLVED,
  TS_ITEMS,
  TS_SIGNATURE,
} from "./completionFixtures.testing.ts";
import { completionType, footnoteOf, offeredBy } from "./completionMenu.ts";
import { completionDocs, rowDetail, signatureDocs } from "./docParts.ts";
import { DocView, loadDocRenderer, type DocPart } from "./docs.tsx";
import { LanguageFeatures } from "./features.ts";
import { CompletionItem, CompletionResult, Signature, decodePayload } from "./payloads.ts";

const item = (raw: Parameters<typeof decodePayload>[1]) => {
  const decoded = decodePayload(CompletionItem, raw);

  if (!decoded) throw new Error("fixture item does not decode");

  return decoded;
};

const panel = (parts: readonly DocPart[]) =>
  render(<DocView docs={{ sections: [parts], variant: "panel" }} />);

const byLabel = <T extends { label: string }>(items: readonly T[], label: string) => {
  const found = items.find((entry) => entry.label === label);

  if (!found) throw new Error(`no ${label} in fixture`);

  return found;
};

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

  return loadDocRenderer();
});

afterEach(async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
  cleanup();
});

describe("completion payloads from real servers", () => {
  test("every captured list decodes, and no row carries a long detail", () => {
    for (const items of [CSS_ITEMS, TS_ITEMS, PYRIGHT_ITEMS]) {
      const decoded = decodePayload(CompletionResult, items);

      expect(decoded).toBeArray();

      for (const entry of items) expect(rowDetail(item(entry))).toBeUndefined();
    }

    expect(rowDetail(item(TS_APPEND_RESOLVED))).toBeUndefined();
    expect(rowDetail(item({ label: "size", detail: "number" }))).toBe("number");
    expect(rowDetail(item({ label: "x", labelDetails: { description: "./hosts" } }))).toBe(
      "./hosts"
    );
  });

  test("rows get an icon by kind", () => {
    expect(completionType(byLabel(TS_ITEMS, "append").kind)).toBe("method");
    expect(completionType(byLabel(CSS_ITEMS, "align-content").kind)).toBe("property");
    expect(completionType(byLabel(PYRIGHT_ITEMS, "dumps").kind)).toBe("function");
    expect(completionType(undefined)).toBe("text");
  });

  test("the footnote names each server once", () => {
    const options = [
      offeredBy({ label: "a" }, "TypeScript 6.0.3 · bundled"),
      offeredBy({ label: "b" }, "TypeScript 6.0.3 · bundled"),
      offeredBy({ label: "c" }, "eslint"),
      { label: "d" },
    ];

    expect(footnoteOf(options)).toBe("TypeScript 6.0.3 · bundled, eslint");
  });
});

describe("completion info", () => {
  test("CSS: no image, the Syntax line as code, MDN as a short https link", async () => {
    const parts = completionDocs(item(byLabel(CSS_ITEMS, "align-content")), "css");

    expect(parts).toHaveLength(1);
    expect(parts[0]?.text).not.toContain("data:image");
    expect(parts[0]?.text).toContain("Widely available across major browsers");

    const { container } = panel(parts);

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toStartWith(
      "normal | <baseline-position> | <content-distribution>"
    );

    const link = container.querySelector("a");

    expect(link?.textContent).toBe("MDN Reference↗");
    expect(link?.getAttribute("href")).toStartWith("https://developer.mozilla.org/");
    expect(container.textContent).not.toContain("Syntax:");
  });

  test("CSS from an older Daemon stays plaintext, wrapping its URL", () => {
    const parts = completionDocs(item(byLabel(CSS_PLAINTEXT_ITEMS, "align-content")), "css");
    const { container } = panel(parts);

    expect(parts[0]?.kind).toBe("plaintext");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("MDN Reference: https://");
  });

  test("CSS display, resolved: prose, then Syntax as code", async () => {
    const { container } = panel(completionDocs(item(CSS_DISPLAY), "css"));

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("p")?.textContent).toStartWith("In combination with 'float'");
  });

  test("TypeScript sends nothing until resolve; then the detail is code above a rule", async () => {
    expect(completionDocs(item(byLabel(TS_ITEMS, "append")), "ts")).toEqual([]);

    const parts = completionDocs(item(TS_APPEND_RESOLVED), "ts");

    expect(parts.map((part) => part.text.split("\n")[0])).toEqual([
      "```ts",
      "---",
      "The **`append()`** method of the URLSearchParams interface appends a specified key/value pair as a new search parameter.",
    ]);

    const { container } = panel(parts);

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("pre")?.textContent).toBe(
      "(method) URLSearchParams.append(name: string, value: string): void"
    );
    expect(container.querySelectorAll("hr")).toHaveLength(1);
    expect(container.querySelector("a")?.textContent).toBe("MDN Reference↗");
  });

  test("basedpyright's resolved docs keep their own signature fence and no duplicate", async () => {
    expect(completionDocs(item(byLabel(PYRIGHT_ITEMS, "dumps")), "py")).toEqual([]);

    const parts = completionDocs(item(PYRIGHT_DUMPS_RESOLVED), "py");

    expect(parts).toHaveLength(1);

    const { container } = panel(parts);

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("pre")?.textContent).toStartWith("def dumps(");
    expect(container.querySelector("[data-docs-footnote]")).toBeNull();
    expect(container.firstElementChild?.className).toContain("w-[360px]");
    expect(container.firstElementChild?.className).toContain("max-h-80");
  });
});

describe("signature help", () => {
  test("the active parameter is marked; the docs follow; the server is the footnote", async () => {
    const payload = decodePayload(Signature, TS_SIGNATURE);

    if (!payload) throw new Error("signature fixture does not decode");
    const parts = signatureDocs(payload);

    expect(parts[0]).toEqual({
      kind: "signature",
      text: "append(name: string, value: string): void",
      active: [21, 34],
    });

    const { container } = render(
      <DocView docs={{ sections: [parts], footnote: "TypeScript 6.0.3", variant: "hover" }} />
    );

    expect(container.querySelector("[data-doc-active]")?.textContent).toBe("value: string");
    expect(container.querySelector("[data-doc-signature]")?.textContent).not.toContain(
      "typescript"
    );
    expect(container.querySelector("[data-docs-footnote]")?.textContent).toBe("TypeScript 6.0.3");
    await waitFor(() => expect(container.querySelector("a")).not.toBeNull());
  });

  test("offset labels and a missing active parameter", () => {
    expect(
      signatureDocs({
        signatures: [{ label: "f(a, b)", parameters: [{ label: [2, 3] }, { label: [5, 6] }] }],
        activeParameter: 0,
      })
    ).toEqual([{ kind: "signature", text: "f(a, b)", active: [2, 3] }]);
    expect(signatureDocs({ signatures: [{ label: "g()" }] })).toEqual([
      { kind: "signature", text: "g()" },
    ]);
    expect(signatureDocs({ signatures: [] })).toEqual([]);
  });
});

describe("the completion source", () => {
  test("rows carry no server id; the info resolves the selected item once", async () => {
    const state = EditorState.create({ doc: `\n${"x".repeat(17)}.` });
    const buffer = { uri: "file:///project/main.ts", version: 1, doc: state.doc };

    const provider = {
      context: { providerId: "typescript-language-server" },
      capabilities: { completionResolve: true },
      completionTriggerCharacters: ["."],
    };

    let resolves = 0;

    const features = {
      options: { buffer: () => buffer, providers: () => [provider] },
      requests: { current: () => true },
      completion: async () => [
        { provider, request: {}, value: {}, payload: decodePayload(CompletionResult, TS_ITEMS) },
      ],
      resolve: async () => {
        resolves++;

        return [{ value: { result: TS_APPEND_RESOLVED } }];
      },
    };

    // SAFETY: a prototype-backed stub; the source reads only the members assigned below.
    const stub = Object.assign(
      Object.create(LanguageFeatures.prototype) as LanguageFeatures,
      features
    );

    const source = completionSource(
      stub,
      { propose: () => {} },
      () => "TypeScript 6.0.3 · bundled"
    );

    const result = await source(new CompletionContext(state, state.doc.length, true));
    const options = result?.options ?? [];

    expect(options.map((option) => option.displayLabel)).toEqual(["append", "delete", "size"]);
    expect(options.map((option) => option.detail)).toEqual([undefined, undefined, undefined]);
    expect(options.map((option) => option.type)).toEqual(["method", "method", "property"]);
    expect(footnoteOf(options)).toBe("TypeScript 6.0.3 · bundled");
    expect(options[0]?.label).toBe(".append");
    expect(result?.getMatch?.(options[0]!, [1, 3])).toEqual([0, 2]);

    const info = options[0]?.info;

    if (!Predicate.isFunction(info)) throw new Error("no lazy info");
    const first = await info(options[0]!);
    await info(options[0]!);

    expect(resolves).toBe(1);
    expect(first && "dom" in first ? first.dom.textContent : "").toContain(
      "URLSearchParams.append"
    );
  });
});
