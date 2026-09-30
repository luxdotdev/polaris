/** The dialog's rows for what is typed: recent folders, the folder listed and its subfolders. */
import { useMemo } from "react";
import type { HostView } from "../../../shared/api.ts";
import { useApp } from "../../shell/hooks.ts";
import { browseOf, folderRows, listError, START, tilde } from "./model.ts";
import { readRecent } from "./recent.ts";
import { type Listing, useListing } from "./useListing.ts";

/** What a row does: open a folder as a Workspace, step into one, or ask Finder (this Mac). */
export type Target =
  | { readonly kind: "open"; readonly path: string }
  | { readonly kind: "folder"; readonly path: string }
  | { readonly kind: "finder" };

export interface Row {
  readonly id: string;
  readonly title: string;
  readonly meta: string | undefined;
  readonly target: Target;
  readonly testId: string;
}

export interface Group {
  readonly heading: string;
  readonly rows: ReadonlyArray<Row>;
}

interface RowsInput {
  readonly host: HostView;
  readonly typed: string;
  readonly listing: Listing;
  readonly workspaces: ReadonlyArray<{ readonly path: string; readonly name: string }>;
  readonly recent: ReadonlyArray<string>;
}

const listedGroup = ({ host, typed, listing, workspaces }: RowsInput): Group | null => {
  const homeDir = host.status.host?.homeDir ?? null;
  const { absolute, filter } = browseOf(typed, homeDir);

  if (absolute === null || listing.kind !== "listed") return null;

  const here = tilde(absolute, homeDir);
  const known = workspaces.find((w) => w.path === absolute);

  const open: Row = {
    id: `open\u0000${absolute}`,
    title: `Open ${here}`,
    target: { kind: "open", path: absolute },
    testId: "folder-open",
    meta: known === undefined ? undefined : `workspace ${known.name}`,
  };

  const folders = folderRows(listing.entries, filter, workspaces).map((row): Row => ({
    id: `dir\u0000${row.path}`,
    title: row.name,
    target: { kind: "folder", path: row.path },
    testId: "folder-row",
    meta: row.workspace === null ? undefined : "workspace",
  }));

  return { heading: here, rows: filter === "" ? [open, ...folders] : folders };
};

/** Pure: the groups for one state of the dialog. */
export const buildGroups = (input: RowsInput): ReadonlyArray<Group> => {
  const homeDir = input.host.status.host?.homeDir ?? null;

  const recent: Group | null =
    input.typed === START && input.recent.length > 0
      ? {
          heading: "Recent",
          rows: input.recent.map((path) => ({
            id: `recent\u0000${path}`,
            title: tilde(path, homeDir),
            target: { kind: "open", path },
            testId: "folder-recent",
            meta: undefined,
          })),
        }
      : null;

  const finder: Group | null =
    input.host.alias === null
      ? {
          heading: input.host.label,
          rows: [
            {
              id: "finder",
              title: "Choose in Finder…",
              target: { kind: "finder" },
              testId: "folder-finder",
              meta: undefined,
            },
          ],
        }
      : null;

  return [recent, listedGroup(input), finder].filter((g): g is Group => g !== null);
};

/** The line when nothing is listed: still listing, can't list, or nothing matches. */
export const emptyLine = (typed: string, listing: Listing, homeDir: string | null): string => {
  const { dir, filter } = browseOf(typed, homeDir);

  if (listing.kind === "failed") return listError(listing.message, dir);

  if (listing.kind !== "listed") return "";

  return filter === "" ? `No folders in ${dir}` : `No folder in ${dir} matches ${filter}`;
};

export const useFolderRows = (host: HostView, typed: string) => {
  const homeDir = host.status.host?.homeDir ?? null;
  const listing = useListing(host.key, browseOf(typed, homeDir).absolute);
  const model = useApp((s) => s.hostModels[host.key]);

  return useMemo(() => {
    const workspaces = model === undefined ? [] : [...model.workspaces.values()];
    const recent = readRecent()[host.key] ?? [];
    const groups = buildGroups({ host, typed, listing, workspaces, recent });

    return {
      groups,
      empty: emptyLine(typed, listing, homeDir),
      byId: new Map(groups.flatMap((g) => g.rows.map((r) => [r.id, r.target]))),
    };
  }, [host, typed, listing, model, homeDir]);
};
