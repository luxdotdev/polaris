import { Schema } from "effect";
import { HostId } from "../ids.ts";
import { LanguageCounter, LanguageKey, LanguagePath, LanguageText } from "./base.ts";
import { LanguageInstallProgress, LanguagePlatform, LanguageRequirement } from "./catalog.ts";
import { deferredSchema } from "./deferred.ts";

export const LanguageHostToolStatus = deferredSchema(() =>
  Schema.TaggedUnion({
    NotDownloaded: {},
    Downloading: { progress: LanguageInstallProgress },
    Installed: { version: LanguageText },
    Failed: { reason: LanguageText, retainedVersion: Schema.NullOr(LanguageText) },
  })
);

export const LanguageHostPrerequisite = Schema.Struct({
  requirement: LanguageRequirement,
  presence: Schema.Literals(["present", "missing", "unknown"]),
  path: Schema.NullOr(LanguagePath),
  version: Schema.NullOr(LanguageText),
});

export type LanguageHostPrerequisite = typeof LanguageHostPrerequisite.Type;

export const LanguageHostToolState = Schema.Struct({
  toolId: LanguageKey,
  pinnedVersion: LanguageText,
  state: LanguageHostToolStatus,
  prerequisites: Schema.Array(LanguageHostPrerequisite).check(Schema.isMaxLength(64)),
  checkedAt: LanguageCounter,
});

export type LanguageHostToolState = typeof LanguageHostToolState.Type;

export const LanguageHostState = Schema.Struct({
  hostId: HostId,
  platform: LanguagePlatform,
  tools: Schema.Array(LanguageHostToolState).check(Schema.isMaxLength(256)),
});

export type LanguageHostState = typeof LanguageHostState.Type;
