/**
 * The Command Palette's sections (DESIGN.md, Command Palette; Paper L5): with no
 * query, Recent, then the focused file's commands, the Workspace's and the app's;
 * with a query, the same groups ranked, the best-matching group first.
 * Search-only commands (easter eggs) appear only for a query.
 */
import type { CommandGroup } from "../../../../shared/keymap.ts";
import type { PaletteCommand } from "../../../routes/commands.ts";
import { itemScore, rank } from "../../jump/ranking.ts";

export type GroupKey = "recent" | CommandGroup;

export interface PaletteGroup {
  readonly key: GroupKey;
  readonly items: ReadonlyArray<PaletteCommand>;
}

export const RECENT_SHOWN = 5;

const ORDER: ReadonlyArray<CommandGroup> = ["file", "workspace", "app"];

export interface GroupsInput {
  readonly query: string;
  readonly commands: ReadonlyArray<PaletteCommand>;
  /** Recently run command ids, newest first. */
  readonly recent: ReadonlyArray<string>;
}

const nonEmpty = (groups: ReadonlyArray<PaletteGroup>) => groups.filter((g) => g.items.length > 0);

const emptyQuery = ({ commands, recent }: GroupsInput): ReadonlyArray<PaletteGroup> => {
  const listed = commands.filter((c) => !c.searchOnly);
  const byId = new Map(listed.map((c) => [c.id, c]));

  const recentItems = recent
    .flatMap((id) => {
      const found = byId.get(id);

      return found === undefined ? [] : [found];
    })
    .slice(0, RECENT_SHOWN);

  const shown = new Set(recentItems.map((c) => c.id));

  return nonEmpty([
    { key: "recent", items: recentItems },
    ...ORDER.map((key) => ({
      key,
      items: listed.filter((c) => c.group === key && !shown.has(c.id)),
    })),
  ]);
};

export const paletteGroups = (input: GroupsInput): ReadonlyArray<PaletteGroup> => {
  const { query, commands, recent } = input;

  if (query.trim() === "") return emptyQuery(input);

  const recency = (c: PaletteCommand) => {
    const at = recent.indexOf(c.id);

    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };

  const ranked = ORDER.map((key) => ({
    key,
    items: rank({
      query,
      items: commands.filter((c) => c.group === key),
      recency,
      limit: Number.POSITIVE_INFINITY,
    }),
  }));

  const best = (group: PaletteGroup) => {
    const first = group.items[0];

    return first === undefined ? 0 : (itemScore(query, first) ?? 0);
  };

  // A stable sort keeps the file, Workspace, app order between equal groups.
  return nonEmpty(ranked).toSorted((a, b) => best(b) - best(a));
};

/** The rows in order, as ↑↓ walk them. */
export const flatten = (groups: ReadonlyArray<PaletteGroup>): ReadonlyArray<PaletteCommand> =>
  groups.flatMap((g) => g.items);
