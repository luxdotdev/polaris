import { expect, test } from "bun:test";
import { clientCapabilities } from "./wire.ts";

test("hovers are asked for as Markdown first, so servers keep their code fences", () => {
  expect(clientCapabilities.textDocument.hover.contentFormat).toEqual(["markdown", "plaintext"]);
});
