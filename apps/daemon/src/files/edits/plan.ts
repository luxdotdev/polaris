import { FileEditFailure } from "./failure.ts";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import {
  LanguageEditProposal,
  type LanguageResourceOperation,
  type FileVersion,
  type LanguageOperationOutcome,
} from "@polaris/protocol";
import { Schema } from "effect";
import { readVersioned, sameVersion } from "../version.ts";
import { canonicalResource, validatePath } from "./paths.ts";
import { syncDirectory, type Journal, type Move } from "./journal.ts";

type Step = LanguageOperationOutcome["steps"][number];

export const resourcePaths = async (root: string, proposal: LanguageEditProposal) => {
  const operations = (proposal.edit.documentChanges ?? []).flatMap((change, index) =>
    "kind" in change ? [{ operation: change, index }] : []
  );

  const paths = new Map<string, string>();

  for (const { operation } of operations) {
    const uris =
      operation.kind === "rename" ? [operation.oldUri, operation.newUri] : [operation.uri];

    for (const uri of uris) paths.set(uri, await canonicalResource(root, uri));
  }

  return { operations, paths };
};

export const prepare = async (
  directory: string,
  root: string,
  input: LanguageEditProposal,
  outcome: LanguageOperationOutcome,
  fingerprint: string
): Promise<Journal> => {
  const proposal = Schema.decodeUnknownSync(LanguageEditProposal)(input);

  if (
    proposal.edit.changes &&
    proposal.edit.documentChanges?.some((change) => "textDocument" in change)
  )
    throw new FileEditFailure({ code: "invalid-operation", message: "Ambiguous text edit forms" });
  const { operations, paths } = await resourcePaths(root, proposal);
  const versions = await snapshotVersions(root, proposal, paths);

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const moves: Move[] = [];
  const steps: Step[] = [];

  const move = (from: string, to: string, version: FileVersion, step: number) => {
    moves.push({ from, to, version, step, state: "pending" });
    versions.set(from, null);
    versions.set(to, version);
  };

  for (const { index, operation } of operations) {
    const from = paths.get(operation.kind === "rename" ? operation.oldUri : operation.uri)!;
    const to = operation.kind === "rename" ? paths.get(operation.newUri)! : from;

    if (operation.kind === "rename" && from === to)
      throw new FileEditFailure({
        code: "invalid-operation",
        message: "Rename aliases the same canonical path",
      });
    const involved = [...new Set([from, to])];
    const before = involved.map((path) => ({ path, version: versions.get(path) ?? null }));
    await planOperation({ directory, versions, move }, operation, index, from, to);

    steps.push({
      index,
      operation,
      state: "prepared",
      before,
      owned: involved.map((path) => ({ path, version: versions.get(path) ?? null })),
      message: "Prepared",
    });
  }

  await syncDirectory(directory);

  return { format: 1, root, fingerprint, moves, outcome: { ...outcome, steps } };
};

type Planning = {
  directory: string;
  versions: Map<string, FileVersion | null>;
  move: (from: string, to: string, version: FileVersion, step: number) => void;
};

const snapshotVersions = async (
  root: string,
  proposal: LanguageEditProposal,
  paths: Map<string, string>
) => {
  const versions = new Map<string, FileVersion | null>();

  for (const path of new Set(paths.values())) {
    const snapshots = proposal.snapshots.filter((snapshot) => snapshot.canonicalPath === path);

    if (snapshots.length !== 1 || (await canonicalResource(root, snapshots[0]!.uri)) !== path)
      throw new FileEditFailure({
        code: "invalid-operation",
        message: "Every canonical resource path requires one unambiguous snapshot",
      });
    const version = await validatePath(root, path);

    if (!sameVersion(version, snapshots[0]!.diskVersion))
      throw new FileEditFailure({ code: "disk-conflict", message: "Resource snapshot is stale" });
    versions.set(path, version);
  }

  return versions;
};

const stageCreate = async (directory: string, index: number) => {
  const stage = join(directory, `create-${index}`);
  const handle = await open(stage, "wx", 0o666);

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }

  return { stage, version: (await readVersioned(stage)).version };
};

const planOperation = async (
  context: Planning,
  operation: typeof LanguageResourceOperation.Type,
  index: number,
  from: string,
  to: string
) => {
  const existing = context.versions.get(to) ?? null;
  const source = context.versions.get(from) ?? null;
  const backup = join(context.directory, `backup-${index}`);

  if (operation.kind === "delete") {
    if (operation.options?.recursive)
      throw new FileEditFailure({
        code: "unsupported-resource",
        message: "Recursive resource deletion is unsupported",
      });

    if (source) context.move(from, backup, source, index);
    else if (!operation.options?.ignoreIfNotExists)
      throw new FileEditFailure({ code: "invalid-operation", message: "Delete source is absent" });

    return;
  }

  if (operation.kind === "rename" && !source)
    throw new FileEditFailure({ code: "invalid-operation", message: "Rename source is absent" });

  if (existing && !operation.options?.overwrite) {
    if (operation.options?.ignoreIfExists) return;
    throw new FileEditFailure({
      code: "invalid-operation",
      message: "Resource destination exists",
    });
  }

  if (existing) context.move(to, backup, existing, index);

  if (operation.kind === "create") {
    const { stage, version } = await stageCreate(context.directory, index);
    context.move(stage, to, version, index);
  } else if (source) context.move(from, to, source, index);
};
