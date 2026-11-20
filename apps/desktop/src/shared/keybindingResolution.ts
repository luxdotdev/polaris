/** Overrides replace an action's keys; a later override takes a contested shortcut. */
import { parseChord, platformChordKey, type KeyPlatform } from "./chord.ts";
import type { KeyBinding, CommandId } from "./keymap.ts";

export type KeybindingOverridesValue = Readonly<Record<string, string | null>>;

const EMPTY: KeybindingOverridesValue = {};

let current = EMPTY;

export const getKeybindingOverrides = (): KeybindingOverridesValue => current;

export const setKeybindingOverrides = (value: KeybindingOverridesValue) => {
  current = value;
};

export interface KeybindingConflict {
  readonly id: CommandId;
  readonly winner: CommandId;
  readonly key: string;
}

export const resolveKeybindings = (
  defaults: ReadonlyArray<KeyBinding>,
  overrides: KeybindingOverridesValue,
  platform: KeyPlatform
) => {
  const owners = new Map<string, CommandId>();

  for (const [id, key] of Object.entries(overrides)) {
    const action = defaults.find((b) => b.id === id);

    if (action && key !== null) owners.set(platformChordKey(parseChord(key), platform), action.id);
  }

  const conflicts: Array<KeybindingConflict> = [];

  const bindings = defaults.map((binding) => {
    const override = overrides[binding.id];
    const keys = override === undefined ? binding.keys : override === null ? [] : [override];

    return {
      ...binding,
      keys: keys.filter((key) => {
        const winner = owners.get(platformChordKey(parseChord(key), platform));

        if (winner === undefined || winner === binding.id) return true;
        conflicts.push({ id: binding.id, winner, key });

        return false;
      }),
    };
  });

  return { bindings, conflicts };
};
