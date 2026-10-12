import { Schema } from "effect";
import { HostId } from "../ids.ts";
import { LanguageCounter } from "./base.ts";

export const LanguageProcessLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }));

export const LanguageHostProcessBudget = Schema.Struct({
  hostId: HostId,
  revision: LanguageCounter,
  maxProcesses: Schema.NullOr(LanguageProcessLimit),
  effectiveLimit: LanguageProcessLimit,
  automaticLimit: LanguageProcessLimit,
  cpuCount: LanguageCounter,
  totalMemoryBytes: LanguageCounter,
  availableMemoryBytes: LanguageCounter,
  serverAllowanceBytes: LanguageCounter,
});

export type LanguageHostProcessBudget = typeof LanguageHostProcessBudget.Type;
