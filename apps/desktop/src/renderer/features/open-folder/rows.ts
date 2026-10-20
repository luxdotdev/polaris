/** The dialog's rows for what is typed: recent folders, the folder listed and its subfolders. */
import { useMemo } from "react";
import type { HostView } from "../../../shared/api.ts";
import { clientCopy } from "../../../shared/clientCopy.ts";
import { useApp } from "../../shell/hooks.ts";
import { joinPath } from "../../../shared/hostPath.ts";
import { browseOf, folderRows, listError, START, tilde } from "./model.ts";
import { readRecent } from "./recent.ts";
import { type Listing, useListing } from "./useListing.ts";

/**
 * What a row does: open a folder as a Workspace, step into one, create one and open it, or
 * ask the OS folder picker (the local Host).
 */
export type Target =
  | { readonly kind: "open"; readonly path: string }
  | { readonly kind: "create"; readonly path: string }
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

/** A name typed that nothing in the folder has yet, on a Host that can make folders. */
const canCreate = ({ host, listing }: RowsInput, name: string) =>
  name !== "." &&
  name !== ".." &&
  host.status.capabilities.includes("files.manage") &&
  listing.kind === "listed" &&
  !listing.entries.some((e) => e.name === name);

const listedGroup = (input: RowsInput): Group | null => {
  const { host, typed, listing, workspaces } = input;
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

  const path = joinPath(absolute, filter);

  const create: ReadonlyArray<Row> = canCreate(input, filter)
    ? [
        {
          id: `create\u0000${path}`,
          title: `Create ${tilde(path, homeDir)}`,
          target: { kind: "create", path },
          testId: "folder-create",
          meta: host.status.capabilities.includes("git.init") ? "new repository" : "new folder",
        },
      ]
    : [];

  return { heading: here, rows: filter === "" ? [open, ...folders] : [...folders, ...create] };
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
    input.host.kind === "local"
      ? {
          heading: input.host.label,
          rows: [
            {
              id: "finder",
              title: clientCopy().chooseFolder,
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
