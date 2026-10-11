import { expect, test } from "bun:test";
import { Schema } from "effect";
import * as P from "@polaris/protocol";
import rawCatalog from "../../../../../../daemon/src/languages/catalog/catalog.json";
import type { LanguageApi } from "../../../../shared/api.ts";
import { statusToolIds, watchHostTools } from "./feed.ts";

const catalog = Schema.decodeUnknownSync(P.LanguageCatalog)(rawCatalog);

test("Python status observes its actual provider dependencies without verifying TypeScript", () => {
  expect(statusToolIds(catalog, "python").sort()).toEqual(["basedpyright", "node", "ruff"]);
  expect(statusToolIds(catalog, "basedpyright").sort()).toEqual(["basedpyright", "node", "ruff"]);

  for (const language of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    const ids = statusToolIds(catalog, language);
    expect(ids).toContain("node");
    expect(ids).toContain("typescript");
    expect(ids).toContain("typescript-language-server");
    expect(ids).not.toContain("basedpyright");
    expect(ids).not.toContain("ruff");
  }
});

test("status never requests an empty Host tool list for unsupported languages and cancels late catalogs", async () => {
  const pending = Promise.withResolvers<P.LanguageCatalog>();
  const subscribed: object[] = [];
  let stops = 0;

  const api: LanguageApi = {
    request: async () => ({ ok: true, value: await pending.promise }),
    subscribe: (kind, input) => {
      subscribed.push({ kind, input });

      return () => stops++;
    },
  };

  const cancelled = watchHostTools(api, "lucas-rpi", "typescript");
  cancelled();
  const unsupported = watchHostTools(api, "lucas-rpi", "plain");
  const python = watchHostTools(api, "lucas-rpi", "python");
  pending.resolve(catalog);
  await Promise.resolve();
  await Promise.resolve();
  expect(subscribed).toEqual([
    {
      kind: "languages.host.state.watch",
      input: { hostKey: "lucas-rpi", toolIds: ["basedpyright", "ruff", "node"], refresh: false },
    },
  ]);
  unsupported();
  python();
  expect(stops).toBe(1);
});
