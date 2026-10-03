import type { LanguageTreeOperationOutcome } from "@polaris/protocol";
import { Match } from "effect";
import type { FileVersion } from "../model/buffer.ts";

/** Only complete applied/restored steps establish a version; unresolved moves establish none. */
export const receiptVersion = (
  outcome: LanguageTreeOperationOutcome,
  path: string
): FileVersion | null => {
  let version: FileVersion | null = null;

  for (const step of outcome.steps) {
    const observations = Match.value(step.state).pipe(
      Match.when("restored", () => step.before),
      Match.when("applied", () => step.owned),
      Match.orElse(() => [])
    );

    for (const observed of observations) {
      const relative = relativeDescendant(observed.path, path);

      if (relative === null) continue;
      const entry = observed.tree?.entries.find((item) => item.relativePath === relative);

      if (entry?.kind === "file") version = entry.version;
    }
  }

  return version;
};

const relativeDescendant = (root: string, path: string): string | null => {
  if (root === path) return "";

  return path.startsWith(root + "/") ? path.slice(root.length + 1) : null;
};
