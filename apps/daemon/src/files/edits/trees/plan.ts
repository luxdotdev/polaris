import { mkdir, open, lstat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  LanguageTreeEditProposal,
  LanguageTreeManifest,
  LanguageTreeOperationOutcome,
  type LanguageResourceOperation,
} from "@polaris/protocol";
import { Schema } from "effect";
import { contained } from "../paths.ts";
import { syncDirectory } from "../journal.ts";
import {
  ancestors,
  budget,
  canonicalTreeResource,
  fail,
  resourceIdentity,
  sameTree,
  snapshotTree,
} from "./snapshot.ts";
import type { Journal, Move } from "./journal.ts";

type Entry = LanguageTreeManifest["entries"][number];

type Virtual = Map<string, Entry>;

export const resourcePaths = async (root: string, proposal: LanguageTreeEditProposal) => {
  const operations = (proposal.edit.documentChanges ?? []).flatMap((change, index) =>
    "kind" in change ? [{ operation: change, index }] : []
  );

  const paths = new Map<string, string>();

  for (const { operation } of operations) {
    const uris =
      operation.kind === "rename" ? [operation.oldUri, operation.newUri] : [operation.uri];

    for (const uri of uris) paths.set(uri, await canonicalTreeResource(root, uri));
  }

  if (new Set(paths.values()).size !== paths.size) fail("Canonical resource URI aliases");

  return { operations, paths };
};

const treeAt = (virtual: Virtual, path: string): LanguageTreeManifest | null => {
  if (!virtual.has(path)) return null;

  const entries = [...virtual].flatMap(([name, entry]) =>
    name === path || contained(path, name)
      ? [{ ...entry, relativePath: relative(path, name).split("\\").join("/") }]
      : []
  );

  entries.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : Number(a.relativePath > b.relativePath)
  );

  return Schema.decodeUnknownSync(LanguageTreeManifest)({ format: 1, entries });
};

const mergeEntry = (virtual: Virtual, path: string, entry: Entry) => {
  const normalized = { ...entry, relativePath: "" };
  const prior = virtual.get(path);

  if (prior && JSON.stringify(prior) !== JSON.stringify(normalized))
    fail("Overlapping snapshot or parent identity changed");
  virtual.set(path, normalized);
};

const mergeSnapshot = (virtual: Virtual, path: string, tree: LanguageTreeManifest | null) => {
  for (const entry of tree?.entries ?? [])
    mergeEntry(virtual, join(path, entry.relativePath), entry);
};

export const validateSnapshots = async (
  root: string,
  proposal: LanguageTreeEditProposal,
  paths: Map<string, string>
) => {
  if (proposal.resourceSnapshots.length !== paths.size)
    fail("Every resource requires exactly one tree snapshot");
  const virtual: Virtual = new Map();
  const first = budget();
  const second = budget();

  for (const path of paths.values()) {
    const expected = proposal.resourceSnapshots.find((snapshot) => snapshot.canonicalPath === path);

    if (!expected || paths.get(expected.uri) !== path) fail("Missing or aliased resource snapshot");
    const observed = await snapshotTree(root, path, first);
    const verified = await snapshotTree(root, path, second);

    if (!sameTree(expected.tree, observed) || !sameTree(observed, verified))
      fail("Resource tree snapshot is stale or unstable");

    mergeSnapshot(virtual, path, observed);

    for (const parent of await ancestors(root, path))
      mergeEntry(virtual, parent.path, {
        relativePath: "",
        kind: "directory",
        identity: parent.identity,
        version: null,
      });
  }

  return virtual;
};

const parentsFor = (virtual: Virtual, root: string, path: string) => {
  const parents: Move["parents"][number][] = [];
  let current = dirname(path);

  while (true) {
    const entry = virtual.get(current);

    if (!entry || entry.kind !== "directory")
      fail("Ordered resource parent is absent or not a directory");
    parents.push({ path: current, identity: entry.identity });

    if (current === root) break;

    if (!contained(root, current)) fail("Ordered parent escapes root");
    current = dirname(current);
  }

  return parents;
};

export const prepare = async (
  directory: string,
  root: string,
  proposal: LanguageTreeEditProposal,
  outcome: LanguageTreeOperationOutcome,
  fingerprint: string
): Promise<Journal> => {
  if (
    proposal.edit.changes &&
    proposal.edit.documentChanges?.some((change) => "textDocument" in change)
  )
    fail("Ambiguous text edit forms");
  const { paths, operations } = await resourcePaths(root, proposal);
  const virtual = await validateSnapshots(root, proposal, paths);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  virtual.set(directory, {
    relativePath: "",
    kind: "directory",
    identity: resourceIdentity(await lstat(directory)),
    version: null,
  });
  const moves: Move[] = [];
  let moveBytes = 0;
  let moveEntries = 0;
  let encodedMoves = 0;
  const steps: LanguageTreeOperationOutcome["steps"][number][] = [];

  const move = (from: string, to: string, tree: LanguageTreeManifest, step: number) => {
    const parents = [
      ...parentsFor(virtual, contained(directory, from) ? directory : root, from),
      ...parentsFor(virtual, contained(directory, to) ? directory : root, to),
    ];

    const planned: Move = { from, to, tree, parents, step, state: "pending" };
    moveBytes += tree.entries.reduce((sum, entry) => sum + (entry.version?.size ?? 0), 0);
    moveEntries += tree.entries.length;
    encodedMoves += Buffer.byteLength(JSON.stringify(planned), "utf8");

    if (moveBytes > 268435456 || moveEntries > 32768 || encodedMoves > 2097152)
      fail("Ordered move validation/journal budget exceeded");
    moves.push(planned);

    for (const entry of tree.entries) virtual.delete(join(from, entry.relativePath));

    for (const entry of tree.entries)
      virtual.set(join(to, entry.relativePath), { ...entry, relativePath: "" });
  };

  for (const { operation, index } of operations) {
    const from = paths.get(operation.kind === "rename" ? operation.oldUri : operation.uri)!;
    const to = operation.kind === "rename" ? paths.get(operation.newUri)! : from;

    if (operation.kind === "rename" && (from === to || contained(from, to) || contained(to, from)))
      fail("Rename overlaps or aliases itself");
    const involved = [...new Set([from, to])];
    const before = involved.map((path) => ({ path, tree: treeAt(virtual, path) }));
    await planOperation(directory, virtual, move, operation, index, from, to);
    steps.push({
      index,
      operation,
      state: "prepared",
      before,
      owned: involved.map((path) => ({ path, tree: treeAt(virtual, path) })),
      message: "Prepared",
    });
  }

  Schema.decodeUnknownSync(LanguageTreeOperationOutcome)({
    ...outcome,
    steps: steps.map((step) => ({ ...step, message: "x".repeat(512) })),
    message: "x".repeat(512),
    receiptRevision: Number.MAX_SAFE_INTEGER,
  });
  await syncDirectory(directory);

  return {
    format: 2,
    root,
    rootIdentity: resourceIdentity(await lstat(root)),
    fingerprint,
    moves,
    outcome: { ...outcome, steps },
  };
};

const planDelete = (
  move: MoveTree,
  operation: Extract<typeof LanguageResourceOperation.Type, { kind: "delete" }>,
  source: LanguageTreeManifest | null,
  from: string,
  backup: string,
  index: number
) => {
  if (
    source?.entries[0]?.kind === "directory" &&
    source.entries.length > 1 &&
    !operation.options?.recursive
  )
    fail("Nonempty directory deletion requires recursive:true");

  if (source) move(from, backup, source, index);
  else if (!operation.options?.ignoreIfNotExists) fail("Delete source is absent");
};

type MoveTree = (from: string, to: string, tree: LanguageTreeManifest, step: number) => void;

const planOperation = async (
  directory: string,
  virtual: Virtual,
  move: MoveTree,
  operation: typeof LanguageResourceOperation.Type,
  index: number,
  from: string,
  to: string
) => {
  const source = treeAt(virtual, from);
  const existing = treeAt(virtual, to);
  const backup = join(directory, `backup-${index}`);

  if (operation.kind === "delete") {
    planDelete(move, operation, source, from, backup, index);

    return;
  }

  if (operation.kind === "rename" && !source) fail("Rename source is absent");

  if (existing && !operation.options?.overwrite) {
    if (operation.options?.ignoreIfExists) return;
    fail("Resource destination exists");
  }

  if (existing) move(to, backup, existing, index);

  if (operation.kind === "create") {
    const stage = join(directory, `create-${index}`);
    const handle = await open(stage, "wx", 0o666);

    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    const tree = await snapshotTree(directory, stage);

    if (!tree) fail("Staged create disappeared");

    for (const entry of tree.entries) virtual.set(stage, entry);
    move(stage, to, tree, index);
  } else if (source) move(from, to, source, index);
};

export const acceptanceLocks = async (
  root: string,
  proposal: LanguageTreeEditProposal,
  paths: Map<string, string>
) => {
  const locks = new Set<string>([root, ...paths.values()]);

  const add = (path: string) => {
    locks.add(path);

    if (locks.size > 16384) fail("Resource lock budget exceeded");
  };

  for (const snapshot of proposal.resourceSnapshots) {
    for (const entry of snapshot.tree?.entries ?? [])
      add(join(snapshot.canonicalPath, entry.relativePath));

    for (const parent of await ancestors(root, snapshot.canonicalPath)) add(parent.path);
  }

  // Include every translated descendant at each possible destination for ordered subtree chains.
  const suffixes = proposal.resourceSnapshots.flatMap(
    (snapshot) => snapshot.tree?.entries.map((entry) => entry.relativePath) ?? []
  );

  for (const path of paths.values()) for (const suffix of suffixes) add(join(path, suffix));

  if (locks.size > 16384) fail("Resource lock budget exceeded");

  return [...locks].sort();
};
