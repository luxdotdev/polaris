import { expect, test } from "bun:test";
import { LanguageError } from "@polaris/protocol";
import { Schema } from "effect";
import { languageIpcError } from "./languageError.ts";

test("structured-cloned language errors retain their tag and reason independently of message", () => {
  const tagged = new LanguageError({
    reason: "awaiting-trust",
    message: "Localized text",
    retryable: false,
  });

  const error = languageIpcError({
    code: "LanguageError",
    message: "Display only",
    languageError: structuredClone(Schema.encodeSync(LanguageError)(tagged)),
  });

  expect(error).toBeInstanceOf(LanguageError);
  expect(error.reason).toBe("awaiting-trust");
  expect(error.message).toBe("Localized text");
});
