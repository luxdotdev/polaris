import { FileEditFailure } from "./failure.ts";
import { rename } from "node:fs/promises";
import { dirname } from "node:path";
import { sameVersion } from "../version.ts";
import { contained, validatePath } from "./paths.ts";
import { syncDirectory, type Journal, type Move } from "./journal.ts";

export class InjectedCrash extends Error {}

export type Fault = (
  point: "prepared" | "intent" | "mutation" | "receipt" | "restore-intent" | "restore-mutation",
  move: number
) => Promise<void>;

export const lockPaths = (journal: Journal) =>
  [...new Set(journal.moves.flatMap((move) => [move.from, move.to]))].sort();

const versions = async (directory: string, journal: Journal, move: Move) => {
  for (const path of [move.from, move.to]) {
    if (!contained(directory, path) && !contained(journal.root, path))
      throw new FileEditFailure({
        code: "invalid-root",
        message: "Journal path escapes operation or checkout",
      });
  }

  return Promise.all([
    validatePath(contained(directory, move.from) ? directory : journal.root, move.from),
    validatePath(contained(directory, move.to) ? directory : journal.root, move.to),
  ]);
};

export const location = async (directory: string, journal: Journal, move: Move) => {
  const [from, to] = await versions(directory, journal, move);

  if (sameVersion(from, move.version) && to === null) return "before";

  if (from === null && sameVersion(to, move.version)) return "after";

  return "conflict";
};

export const moveFile = async (from: string, to: string) => {
  await rename(from, to);
  await syncDirectory(dirname(from));

  if (dirname(from) !== dirname(to)) await syncDirectory(dirname(to));
};
