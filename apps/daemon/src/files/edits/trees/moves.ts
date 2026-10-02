import { lstat, realpath } from "node:fs/promises";
import { contained } from "../paths.ts";
import {
  budget,
  fail,
  resourceIdentity,
  sameIdentity,
  sameTree,
  snapshotTree,
} from "./snapshot.ts";
import type { Journal, Move } from "./journal.ts";

export { InjectedCrash, moveFile } from "../moves.ts";

export type { Fault } from "../moves.ts";

export const lockPaths = (journal: Journal) =>
  [
    ...new Set(
      journal.moves.flatMap((move) => [
        ...move.parents.map((parent) => parent.path),
        ...move.tree.entries.flatMap((entry) => [
          entry.relativePath ? `${move.from}/${entry.relativePath}` : move.from,
          entry.relativePath ? `${move.to}/${entry.relativePath}` : move.to,
        ]),
      ])
    ),
  ].sort();

export const location = async (directory: string, journal: Journal, move: Move) => {
  const root = await lstat(journal.root);

  if (!root.isDirectory() || !sameIdentity(journal.rootIdentity, resourceIdentity(root)))
    fail("Checkout root replaced");

  await validateParents(move);

  const observations = [];

  for (const path of [move.from, move.to]) {
    if (!contained(directory, path) && !contained(journal.root, path))
      fail("Journal resource escapes owned roots");
    const rootPath = contained(directory, path) ? directory : journal.root;
    const before = await snapshotTree(rootPath, path, budget());
    const after = await snapshotTree(rootPath, path, budget());

    if (!sameTree(before, after)) return "conflict";
    observations.push(after);
  }

  const [from, to] = observations;

  if (sameTree(from ?? null, move.tree) && to === null) return "before";

  if (from === null && sameTree(to ?? null, move.tree)) return "after";

  return "conflict";
};

const validateParents = async (move: Move) => {
  for (const parent of move.parents) {
    const stat = await lstat(parent.path);

    if (
      !stat.isDirectory() ||
      !sameIdentity(parent.identity, resourceIdentity(stat)) ||
      (await realpath(parent.path)) !== parent.path
    )
      fail("Move parent replaced");
  }
};
