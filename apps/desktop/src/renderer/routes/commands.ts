/**
 * The shell's command registry: every keyboard shortcut, menu item and jump
 * menu action runs a command by id (`shared/keymap.ts`). The shell and
 * features register handlers; the latest registration of an id wins until it
 * is removed, so a view can take a command over while it is mounted.
 */
import { type Chord, isBare, matches, parseChord } from "../../shared/chord.ts";
import { type CommandId, KEYMAP } from "../../shared/keymap.ts";

export interface CommandHandler {
  readonly run: () => void;
  /** Whether it can run now (a session is selected, an approval is pending…); default yes. */
  readonly enabled?: () => boolean;
}

export type CommandHandlers = Partial<Record<CommandId, CommandHandler>>;

export interface CommandRegistry {
  /** Adds handlers; call the returned function to remove them. */
  readonly register: (handlers: CommandHandlers) => () => void;
  readonly enabled: (id: CommandId) => boolean;
  /** Runs the command if it has an enabled handler; true when it ran. */
  readonly run: (id: CommandId) => boolean;
  /** Runs the shortcut a key event is bound to; true when it ran. */
  readonly handleKey: (event: KeyInput) => boolean;
}

export interface KeyInput {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** The event's target is a text field, where bare keys are typing. */
  readonly typing: boolean;
}

interface Bound {
  readonly id: CommandId;
  readonly chord: Chord;
  readonly inFields: boolean;
}

const BOUND: ReadonlyArray<Bound> = KEYMAP.flatMap((b) =>
  b.keys.map((key) => ({ id: b.id, chord: parseChord(key), inFields: b.inFields ?? true }))
);

export interface RegistryInput {
  /** ⌘ is the mod key on macOS, Ctrl elsewhere. */
  readonly mac: boolean;
}

export const createCommandRegistry = ({ mac }: RegistryInput): CommandRegistry => {
  const layers: Array<CommandHandlers> = [];

  const handler = (id: CommandId) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const found = layers[i]?.[id];

      if (found !== undefined) return found;
    }

    return undefined;
  };

  const enabled = (id: CommandId) => {
    const found = handler(id);

    return found !== undefined && (found.enabled?.() ?? true);
  };

  const run = (id: CommandId) => {
    if (!enabled(id)) return false;
    handler(id)?.run();

    return true;
  };

  return {
    register: (handlers) => {
      layers.push(handlers);

      return () => {
        const at = layers.indexOf(handlers);

        if (at !== -1) layers.splice(at, 1);
      };
    },
    enabled,
    run,
    handleKey: (event) => {
      const bound = BOUND.find(
        (b) => matches(b.chord, event, mac) && !(event.typing && (isBare(b.chord) || !b.inFields))
      );

      return bound === undefined ? false : run(bound.id);
    },
  };
};
