/** The easter eggs: search-only palette commands, found by typing a game's full name. */
import type { ContributedCommand } from "../../routes/commands.ts";
import { openGame } from "./store.ts";

export const arcadeCommands = (): ReadonlyArray<ContributedCommand> => [
  {
    id: "fun.invaders",
    title: "Space Invaders",
    palette: { group: "app", searchOnly: true },
    handler: { run: () => openGame("invaders") },
  },
  {
    id: "fun.pong",
    title: "Pong",
    palette: { group: "app", searchOnly: true },
    handler: { run: () => openGame("pong") },
  },
];
