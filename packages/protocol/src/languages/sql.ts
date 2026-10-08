import { Schema } from "effect";
import { LanguageCheckout, LanguageCounter, LanguagePath } from "./base.ts";

export const LanguageSqlDialect = Schema.Literals(["postgresql", "mysql", "sqlite", "generic"]);

export type LanguageSqlDialect = typeof LanguageSqlDialect.Type;

export const LanguageSqlDialectState = Schema.Struct({
  checkout: LanguageCheckout,
  path: LanguagePath,
  revision: LanguageCounter,
  dialect: LanguageSqlDialect,
  source: Schema.Literals(["file", "workspace", "hint", "filename", "prisma", "default"]),
  fileOverride: Schema.NullOr(LanguageSqlDialect),
  workspaceOverride: Schema.NullOr(LanguageSqlDialect),
});
