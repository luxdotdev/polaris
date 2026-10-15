import { expect, test } from "bun:test";
import { clientCapabilities } from "./wire.ts";

test("hovers are asked for as Markdown first, so servers keep their code fences", () => {
  expect(clientCapabilities.textDocument.hover.contentFormat).toEqual(["markdown", "plaintext"]);
});

test("completion and signature docs are asked for as Markdown, resolved on selection", () => {
  const { completion, signatureHelp } = clientCapabilities.textDocument;

  expect(completion.completionItem.documentationFormat).toEqual(["markdown", "plaintext"]);
  expect(completion.completionItem.resolveSupport.properties).toEqual([
    "documentation",
    "detail",
    "additionalTextEdits",
  ]);
  expect(completion.completionItem.labelDetailsSupport).toBe(true);
  expect(signatureHelp.signatureInformation.documentationFormat).toEqual(["markdown", "plaintext"]);
});

test("code actions are asked for as literals with isPreferred, so quick fixes arrive with their edits", () => {
  const { codeAction } = clientCapabilities.textDocument;

  expect(codeAction.codeActionLiteralSupport.codeActionKind.valueSet).toContain("quickfix");
  expect(codeAction.isPreferredSupport).toBe(true);
  expect(codeAction.resolveSupport.properties).toContain("edit");
});
