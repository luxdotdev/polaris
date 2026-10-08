import { expect, test } from "bun:test";
import { catalog } from "../catalog/index.ts";
import { negotiate, pythonCapabilities } from "../runtime/capabilities.ts";
import {
  readReviewRecords,
  reviewFailures,
} from "../../../../../tooling/language-catalog/review.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("Python release offers two labelled providers with exactly Ruff formatting", () => {
  const integration = catalog.integrations.find((item) => item.id === "python")!;
  expect(integration.offered).toBe(true);
  expect(integration.providers.map((provider) => [provider.id, provider.diagnostics])).toEqual([
    ["basedpyright", "types"],
    ["ruff", "lint"],
  ]);
  expect(integration.formatter.tool).toBe("ruff");

  const base = negotiate({
    capabilities: {
      hoverProvider: true,
      completionProvider: {},
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      codeActionProvider: true,
    },
  });

  expect(pythonCapabilities(base, "basedpyright").methods).not.toContain("textDocument/formatting");
  expect(pythonCapabilities(base, "basedpyright").methods).toContain("textDocument/hover");
  const ruff = pythonCapabilities(base, "ruff");
  expect(ruff.methods).not.toContain("textDocument/hover");
  expect(ruff.methods).not.toContain("textDocument/completion");
  expect(ruff.methods).toContain("textDocument/formatting");
  expect(ruff.methods).toContain("textDocument/codeAction");
});

test("runtime download approval binds both Python tools to pinned archives and retained notices", () => {
  const root = join(import.meta.dir, "../../../../../tooling/language-catalog");
  const tools = catalog.tools.filter((tool) => ["basedpyright", "ruff"].includes(tool.id));

  const records = readReviewRecords(root).filter((record) =>
    tools.some((tool) => tool.id === record.tool)
  );

  expect(
    reviewFailures({ tools, records, read: (path) => readFileSync(join(root, path)) })
  ).toEqual([]);
  expect(
    tools.every(
      (tool) =>
        tool.distribution === "runtime-upstream" &&
        tool.license === "MIT" &&
        tool.artifacts.every((artifact) => artifact.audit === "verified")
    )
  ).toBe(true);
  const ruff = tools.find((tool) => tool.id === "ruff")!;
  expect(
    ruff.artifacts.some((artifact) =>
      artifact.platforms.some((platform) => platform.os === "linux" && platform.arch === "arm64")
    )
  ).toBe(true);
});

test("runtime download scope still rejects a nonpermissive top-level licence", () => {
  const root = join(import.meta.dir, "../../../../../tooling/language-catalog");
  const tool = { ...catalog.tools.find((item) => item.id === "ruff")!, license: "GPL-3.0" };
  expect(
    reviewFailures({
      tools: [tool],
      records: readReviewRecords(root).filter((record) => record.tool === "ruff"),
      read: (path) => readFileSync(join(root, path)),
    })
  ).toContain("ruff:runtime-upstream-license");
});

test("the admitted basedpyright artifact binds the exact Polaris interpreter guard", () => {
  const root = join(import.meta.dir, "../../../../../tooling/language-catalog");
  expect(readFileSync(join(root, "managed-python-guard.txt"))).toEqual(
    readFileSync(join(import.meta.dir, "guard.txt"))
  );
});
