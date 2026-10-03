import { Schema } from "effect";
import {
  LanguageKey,
  LanguageCheckout,
  LanguagePath,
  LanguageEffectiveSettings,
} from "@polaris/protocol";

export const Acquire = Schema.Struct({
  clientId: LanguageKey,
  contextId: LanguageKey,
  interestId: LanguageKey,
  checkout: LanguageCheckout,
  path: LanguagePath,
  providerId: LanguageKey,
  settings: LanguageEffectiveSettings,
  refresh: Schema.optionalKey(Schema.Boolean),
});
