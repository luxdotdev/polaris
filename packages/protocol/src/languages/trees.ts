import { Schema } from "effect";
import { FileVersion } from "../files.ts";
import {
  LanguageCounter,
  LanguageFingerprint,
  LanguageKey,
  LanguagePath,
  LanguageRelativePath,
  LanguageUri,
} from "./base.ts";
import {
  LanguageEditAcceptance,
  LanguageEditProposal,
  LanguageOperationOutcome,
  LanguageOperationStep,
} from "./edits.ts";

/** Hard wire/runtime bounds; consumers may choose smaller limits, never larger ones. */
export const languageTreeLimits = {
  entries: 4096,
  depth: 64,
  bytes: 67108864,
  resources: 128,
  encodedBytes: 1048576,
  proposalBytes: 1048576,
};

export const LanguageResourceIdentity = Schema.Struct({
  device: LanguageCounter,
  inode: LanguageCounter,
  mode: LanguageCounter.check(Schema.isLessThanOrEqualTo(0o7777)),
});

const TreeFileVersion = FileVersion.check(
  Schema.makeFilter(
    (version) =>
      Number.isFinite(version.mtimeMs) &&
      Number.isSafeInteger(version.size) &&
      version.size >= 0 &&
      /^[a-f0-9]{64}$/.test(version.hash)
  )
);

export const LanguageTreeEntry = Schema.Struct({
  relativePath: Schema.Union([Schema.Literal(""), LanguageRelativePath]),
  kind: Schema.Literals(["file", "directory"]),
  identity: LanguageResourceIdentity,
  version: Schema.NullOr(TreeFileVersion),
}).check(Schema.makeFilter((entry) => (entry.kind === "file") === (entry.version !== null)));

/** Sorted complete no-follow manifest, including root at ""; symlinks/special entries are unsupported. */
export const LanguageTreeManifest = Schema.Struct({
  format: Schema.Literal(1),
  entries: Schema.Array(LanguageTreeEntry).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(languageTreeLimits.entries)
  ),
}).check(
  Schema.makeFilter(({ entries }) => {
    if (
      entries[0]?.relativePath !== "" ||
      new TextEncoder().encode(JSON.stringify(entries)).byteLength > languageTreeLimits.encodedBytes
    )
      return false;
    const directories = new Set<string>();
    let previous = "";
    let bytes = 0;

    for (const [index, entry] of entries.entries()) {
      const path = entry.relativePath;

      if (index > 0 && path <= previous) return false;

      if (path.split("/").length > languageTreeLimits.depth) return false;

      if (
        path !== "" &&
        !directories.has(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")
      )
        return false;

      if (entry.kind === "directory") directories.add(path);
      bytes += entry.version?.size ?? 0;
      previous = path;
    }

    return bytes <= languageTreeLimits.bytes;
  })
);

export type LanguageTreeManifest = typeof LanguageTreeManifest.Type;

/** Null owns absence; both source and overwritten destination require exact canonical snapshots. */
export const LanguageResourceSnapshot = Schema.Struct({
  uri: LanguageUri,
  canonicalPath: LanguagePath,
  tree: Schema.NullOr(LanguageTreeManifest),
});

const ResourceSnapshots = Schema.Array(LanguageResourceSnapshot).check(
  Schema.isMaxLength(languageTreeLimits.resources),
  Schema.makeFilter((snapshots) => {
    const entries = snapshots.flatMap((snapshot) => snapshot.tree?.entries ?? []);

    return (
      new Set(snapshots.map((snapshot) => snapshot.canonicalPath)).size === snapshots.length &&
      entries.length <= languageTreeLimits.entries &&
      new TextEncoder().encode(JSON.stringify(snapshots)).byteLength <=
        languageTreeLimits.encodedBytes &&
      entries.reduce((bytes, entry) => bytes + (entry.version?.size ?? 0), 0) <=
        languageTreeLimits.bytes
    );
  })
);

const wireBounded = <A>(value: A) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength <= languageTreeLimits.encodedBytes;

const boundedWire = Schema.makeFilter(wireBounded);

export const LanguageTreeEditProposal = Schema.Struct({
  format: Schema.Literal(2),
  ...LanguageEditProposal.fields,
  resourceSnapshots: ResourceSnapshots,
}).check(
  Schema.makeFilter(
    (proposal) =>
      new TextEncoder().encode(JSON.stringify(proposal)).byteLength <=
      languageTreeLimits.proposalBytes
  )
);

export type LanguageTreeEditProposal = typeof LanguageTreeEditProposal.Type;

export const LanguageTreeEditAcceptance = Schema.Struct({
  format: Schema.Literal(2),
  ...LanguageEditAcceptance.fields,
  resourceSnapshots: ResourceSnapshots,
}).check(boundedWire);

export type LanguageTreeEditAcceptance = typeof LanguageTreeEditAcceptance.Type;

/** R1 persists every affected dirty descendant, rename mapping and overwritten draft before Host moves. */
export const LanguageTreeDraftReceipt = Schema.Struct({
  format: Schema.Literal(2),
  durable: Schema.Literal(true),
  groupId: LanguageKey,
  previewFingerprint: LanguageFingerprint,
  resourceSnapshots: ResourceSnapshots,
  descendants: Schema.Array(
    Schema.Struct({
      canonicalPath: LanguagePath,
      draftRevision: LanguageCounter,
      version: LanguageCounter,
    })
  ).check(
    Schema.isMaxLength(languageTreeLimits.entries),
    Schema.makeFilter(
      (entries) => new Set(entries.map((entry) => entry.canonicalPath)).size === entries.length
    )
  ),
}).check(boundedWire);

export type LanguageTreeDraftReceipt = typeof LanguageTreeDraftReceipt.Type;

export const LanguageTreeOperationStep = Schema.Struct({
  ...LanguageOperationStep.fields,
  before: Schema.Array(
    Schema.Struct({ path: LanguagePath, tree: Schema.NullOr(LanguageTreeManifest) })
  ).check(Schema.isMaxLength(2)),
  owned: Schema.Array(
    Schema.Struct({ path: LanguagePath, tree: Schema.NullOr(LanguageTreeManifest) })
  ).check(Schema.isMaxLength(2)),
});

export const LanguageTreeOperationOutcome = Schema.Struct({
  ...LanguageOperationOutcome.fields,
  format: Schema.Literal(2),
  steps: Schema.Array(LanguageTreeOperationStep).check(Schema.isMaxLength(1024)),
}).check(
  boundedWire,
  Schema.makeFilter(
    (value) => value.state !== "applied" || (value.draftsDurable && value.receiptDurable)
  )
);

export type LanguageTreeOperationOutcome = typeof LanguageTreeOperationOutcome.Type;

/** Route before legacy Struct decoding; malformed/versionless trees must never lose ownership fields. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Schema boundary routes untrusted transport JSON before legacy decoding.
export const decodeLanguageResourceProposal = (input: unknown) => {
  const object = Schema.decodeUnknownSync(Schema.JsonObject)(input);

  if (new TextEncoder().encode(JSON.stringify(object)).byteLength > languageTreeLimits.encodedBytes)
    throw new Error("Resource proposal exceeds wire limit");

  if ("format" in object || "resourceSnapshots" in object)
    return Schema.decodeUnknownSync(LanguageTreeEditProposal)(object);

  return Schema.decodeUnknownSync(LanguageEditProposal)(object);
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Schema boundary routes untrusted transport JSON before legacy decoding.
export const decodeLanguageResourceAcceptance = (input: unknown) => {
  const object = Schema.decodeUnknownSync(Schema.JsonObject)(input);

  if (new TextEncoder().encode(JSON.stringify(object)).byteLength > languageTreeLimits.encodedBytes)
    throw new Error("Resource acceptance exceeds wire limit");

  if ("format" in object || "resourceSnapshots" in object)
    return Schema.decodeUnknownSync(LanguageTreeEditAcceptance)(object);

  return Schema.decodeUnknownSync(LanguageEditAcceptance)(object);
};

/** Dedicated RPC payload schema; apply before codec/Client validation, never after legacy decoding. */
export const LanguageTreeEditDecision = Schema.Struct({
  acceptance: LanguageTreeEditAcceptance,
  drafts: Schema.NullOr(LanguageTreeDraftReceipt),
}).check(
  boundedWire,
  Schema.makeFilter(
    ({ acceptance, drafts }) =>
      (acceptance.decision === "reject" || drafts !== null) &&
      (drafts === null ||
        JSON.stringify(acceptance.resourceSnapshots) === JSON.stringify(drafts.resourceSnapshots))
  )
);

export type LanguageTreeEditDecision = typeof LanguageTreeEditDecision.Type;
