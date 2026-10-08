import { Schema } from "effect";
import { LanguageCheckout } from "./base.ts";
import { LanguageCounter, LanguagePath } from "./base.ts";

export const LanguagePythonInterpreter = Schema.Struct({
  path: LanguagePath,
  source: Schema.Literals(["venv", "uv", "host", "override"]),
});

export const LanguagePythonInterpreters = Schema.Struct({
  checkout: LanguageCheckout,
  revision: LanguageCounter,
  override: Schema.NullOr(LanguagePath),
  selected: Schema.NullOr(LanguagePath),
  interpreters: Schema.Array(LanguagePythonInterpreter).check(Schema.isMaxLength(32)),
});
