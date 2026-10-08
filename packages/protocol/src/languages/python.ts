import { Schema } from "effect";
import { LanguageCheckout } from "./base.ts";
import { LanguageCounter, LanguagePath } from "./base.ts";

/** "3.12.4" or "3.12", read from pyvenv.cfg or the binary's name; never by running Python. */
export const LanguagePythonVersion = Schema.String.check(
  Schema.isMaxLength(32),
  Schema.isPattern(/^\d+\.\d+(?:\.\d+)?$/)
);

export const LanguagePythonInterpreter = Schema.Struct({
  path: LanguagePath,
  source: Schema.Literals(["venv", "uv", "host", "override"]),
  /** Absent when neither pyvenv.cfg nor the file name says; older Daemons never send it. */
  version: Schema.optionalKey(LanguagePythonVersion),
});

export const LanguagePythonInterpreters = Schema.Struct({
  checkout: LanguageCheckout,
  revision: LanguageCounter,
  override: Schema.NullOr(LanguagePath),
  selected: Schema.NullOr(LanguagePath),
  interpreters: Schema.Array(LanguagePythonInterpreter).check(Schema.isMaxLength(32)),
});
