import * as Languages from "@polaris/protocol";
import { Schema } from "effect";

const HostKey = Schema.String.check(Schema.isMinLength(1));

const onHost = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Struct({ hostKey: HostKey, ...fields });

/** Main fetches bounded media; the renderer creates/revokes object URLs from these bytes. */
export const LanguagePreviewMediaView = Schema.Struct({
  mimeType: Schema.String.check(Schema.isPattern(/^image\/(png|jpeg|gif|webp|avif)$/)),
  bytes: Languages.LanguageCounter.check(Schema.isLessThanOrEqualTo(10485760)),
  base64: Schema.String.check(
    Schema.isMaxLength(13981016),
    Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/)
  ),
}).check(
  Schema.makeFilter(
    (value) =>
      value.base64.length % 4 === 0 &&
      value.bytes ===
        (value.base64.length / 4) * 3 -
          (value.base64.length - value.base64.replace(/=+$/, "").length)
  )
);

/** Main must enforce remembered Workspace consent, redirect limits and credential-free requests. */
const ExternalImageUrl = Schema.String.check(
  Schema.isMaxLength(8192),
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);

      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  })
);

/** Opt-in tables for C1; current required request/subscription tables remain unchanged. */

export const LanguageRequestInputs = {
  "languages.catalog": onHost(Languages.GetLanguageCatalog.payloadSchema.fields),
  "languages.availability": onHost(Languages.GetLanguageAvailability.payloadSchema.fields),
  "languages.install": onHost(Languages.InstallLanguageTool.payloadSchema.fields),
  "languages.install.cancel": onHost(Languages.CancelLanguageInstall.payloadSchema.fields),
  "languages.discover": onHost(Languages.DiscoverLanguageProject.payloadSchema.fields),
  "languages.trust.get": onHost(Languages.GetLanguageTrust.payloadSchema.fields),
  "languages.trust.set": onHost(Languages.SetLanguageTrust.payloadSchema.fields),
  "languages.context.acquire": onHost(Languages.AcquireLanguageContext.payloadSchema.fields),
  "languages.context.release": onHost(Languages.ReleaseLanguageContext.payloadSchema.fields),
  "languages.context.restart": onHost(Languages.RestartLanguageContext.payloadSchema.fields),
  "languages.document.sync": onHost(Languages.SyncLanguageDocument.payloadSchema.fields),
  "languages.request": onHost(Languages.RequestLanguageFeature.payloadSchema.fields),
  "languages.cancel": onHost(Languages.CancelLanguageRequest.payloadSchema.fields),
  "languages.progress.cancel": onHost(Languages.CancelLanguageProgress.payloadSchema.fields),
  "languages.server.respond": onHost(Languages.RespondLanguageServer.payloadSchema.fields),
  "languages.context.configure": onHost(Languages.ConfigureLanguageContext.payloadSchema.fields),
  "languages.format": onHost(Languages.PreflightLanguageFormat.payloadSchema.fields),
  "languages.edit.decide": onHost(Languages.AcceptLanguageEdit.payloadSchema.fields),
  "languages.operation.get": onHost(Languages.GetLanguageOperation.payloadSchema.fields),
  "languages.operation.recover": onHost(Languages.RecoverLanguageOperation.payloadSchema.fields),
  "languages.preview.media": onHost(Languages.ReadLanguagePreviewMedia.payloadSchema.fields),
  "languages.preview.external": onHost({
    workspaceId: Languages.WorkspaceId,
    url: ExternalImageUrl,
    maxBytes: Languages.LanguageCounter.check(Schema.isBetween({ minimum: 1, maximum: 10485760 })),
  }),
  "languages.settings.get": onHost(Languages.GetLanguageSettings.payloadSchema.fields),
  "languages.settings.set": onHost(Languages.SetLanguageSettings.payloadSchema.fields),
  "languages.preview.policy.get": onHost(Languages.GetLanguagePreviewPolicy.payloadSchema.fields),
  "languages.preview.policy.set": onHost(Languages.SetLanguagePreviewPolicy.payloadSchema.fields),
} as const;

export const LanguageRequestOutputs = {
  "languages.catalog": Languages.GetLanguageCatalog.successSchema,
  "languages.availability": Languages.GetLanguageAvailability.successSchema,
  "languages.install": Languages.InstallLanguageTool.successSchema,
  "languages.install.cancel": Languages.CancelLanguageInstall.successSchema,
  "languages.discover": Languages.DiscoverLanguageProject.successSchema,
  "languages.trust.get": Languages.GetLanguageTrust.successSchema,
  "languages.trust.set": Languages.SetLanguageTrust.successSchema,
  "languages.context.acquire": Languages.AcquireLanguageContext.successSchema,
  "languages.context.release": Languages.ReleaseLanguageContext.successSchema,
  "languages.context.restart": Languages.RestartLanguageContext.successSchema,
  "languages.document.sync": Languages.SyncLanguageDocument.successSchema,
  "languages.request": Languages.RequestLanguageFeature.successSchema,
  "languages.cancel": Languages.CancelLanguageRequest.successSchema,
  "languages.progress.cancel": Languages.CancelLanguageProgress.successSchema,
  "languages.server.respond": Languages.RespondLanguageServer.successSchema,
  "languages.context.configure": Languages.ConfigureLanguageContext.successSchema,
  "languages.format": Languages.PreflightLanguageFormat.successSchema,
  "languages.edit.decide": Languages.AcceptLanguageEdit.successSchema,
  "languages.operation.get": Languages.GetLanguageOperation.successSchema,
  "languages.operation.recover": Languages.RecoverLanguageOperation.successSchema,
  "languages.preview.media": LanguagePreviewMediaView,
  "languages.preview.external": LanguagePreviewMediaView,
  "languages.settings.get": Languages.GetLanguageSettings.successSchema,
  "languages.settings.set": Languages.SetLanguageSettings.successSchema,
  "languages.preview.policy.get": Languages.GetLanguagePreviewPolicy.successSchema,
  "languages.preview.policy.set": Languages.SetLanguagePreviewPolicy.successSchema,
} as const;

export const LanguageSubscriptionInputs = {
  "languages.context.watch": onHost(Languages.WatchLanguageContext.payloadSchema.fields),
  "languages.install.watch": onHost(Languages.WatchLanguageInstall.payloadSchema.fields),
  "languages.availability.watch": onHost(Languages.WatchLanguageAvailability.payloadSchema.fields),
} as const;

export const LanguageSubscriptionItems = {
  "languages.context.watch": Languages.LanguageContextEvent,
  "languages.install.watch": Languages.LanguageInstallProgress,
  "languages.availability.watch": Schema.Array(Languages.LanguageAvailability).check(
    Schema.isMaxLength(512)
  ),
} as const;

export type LanguageRequestMethod = keyof typeof LanguageRequestInputs;

export type LanguageRequestInput<M extends LanguageRequestMethod> =
  (typeof LanguageRequestInputs)[M]["Type"];

export type LanguageRequestOutput<M extends LanguageRequestMethod> =
  (typeof LanguageRequestOutputs)[M]["Type"];

export type LanguageSubscriptionKind = keyof typeof LanguageSubscriptionInputs;

export type LanguageSubscriptionInput<K extends LanguageSubscriptionKind> =
  (typeof LanguageSubscriptionInputs)[K]["Type"];

export type LanguageSubscriptionItem<K extends LanguageSubscriptionKind> =
  (typeof LanguageSubscriptionItems)[K]["Type"];

/** Preview/source are separate views sharing one buffer; this is unrelated to unpinned source tabs. */

export const LanguageEditorView = Schema.TaggedUnion({
  Source: { hostKey: HostKey, path: Languages.LanguagePath },
  MarkdownPreview: {
    viewId: Languages.LanguageKey,
    hostKey: HostKey,
    path: Languages.LanguagePath,
    locked: Schema.Boolean,
  },
});

export type LanguageEditorView = typeof LanguageEditorView.Type;
