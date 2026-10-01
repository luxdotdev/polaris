/**
 * The commands an ACP agent offers, as its sessions report them
 * (`available_commands_update`). ACP has no way to ask without a session, so
 * the driver keeps the latest report per directory; until a session there
 * reports, there are none. Agents read `/name args` in a prompt's text.
 */
import { SlashCommand } from "@polaris/protocol";
import type * as P from "./protocol.ts";

export const toCommand = (
  command: (typeof P.AvailableCommandsUpdate.Type)["availableCommands"][number]
): SlashCommand =>
  new SlashCommand({
    name: command.name,
    sigil: "/",
    description: command.description,
    argumentHint: command.input?.hint ?? null,
    kind: "command",
    source: "built-in",
    plugin: null,
    run: "text",
    action: null,
    template: null,
  });

/** The latest commands reported in each directory. */
export class AcpCommands {
  readonly #byCwd = new Map<string, ReadonlyArray<SlashCommand>>();

  record(cwd: string, update: typeof P.AvailableCommandsUpdate.Type): void {
    this.#byCwd.set(
      cwd,
      update.availableCommands.map(toCommand).sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  list(cwd: string): ReadonlyArray<SlashCommand> {
    return this.#byCwd.get(cwd) ?? [];
  }
}
