/** The Changes view: every changed file under the Workspace, one row each, by path. */
import type { GitStatus } from "@polaris/ui";
import type { AgentMarks } from "./agents.ts";
import type { GitMarks } from "./git.ts";
import { basename, dirname, relative } from "./paths.ts";

export interface ChangeRow {
  readonly path: string;
  readonly name: string;
  /** The folder relative to the Workspace, "" at its top: the row's caption. */
  readonly folder: string;
  readonly git: GitStatus;
  readonly agent: string | null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const changeRows = (
  root: string,
  marks: GitMarks,
  agents: AgentMarks
): ReadonlyArray<ChangeRow> =>
  [...marks.files]
    .flatMap(([path, git]): Array<ChangeRow> =>
      git === "ignored"
        ? []
        : [
            {
              path,
              name: basename(path),
              folder: relative(dirname(path), root),
              git,
              agent: agents.editing.get(path) ?? null,
            },
          ]
    )
    .sort((a, b) => collator.compare(a.folder, b.folder) || collator.compare(a.name, b.name));
