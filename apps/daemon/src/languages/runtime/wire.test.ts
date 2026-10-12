import { expect, test } from "bun:test";
import { clientCapabilities } from "./wire.ts";

test("hovers are asked for as Markdown first, so servers keep their code fences", () => {
  expect(clientCapabilities.textDocument.hover.contentFormat).toEqual(["markdown", "plaintext"]);
});

test("completion and signature docs are asked for as Markdown, resolved on selection", () => {
  const { completion, signatureHelp } = clientCapabilities.textDocument;

  expect(completion.completionItem.documentationFormat).toEqual(["markdown", "plaintext"]);
  expect(completion.completionItem.resolveSupport.properties).toEqual(["documentation", "detail"]);
  expect(completion.completionItem.labelDetailsSupport).toBe(true);
  expect(signatureHelp.signatureInformation.documentationFormat).toEqual(["markdown", "plaintext"]);
});
