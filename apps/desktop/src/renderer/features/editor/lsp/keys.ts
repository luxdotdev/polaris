/** The Editor's language keys: F12 definition, ⇧F12 references, ⇧⌘O symbols, ⌥← back. */
import { keymap } from "@codemirror/view";
import type { LanguageCommand } from "./queries.ts";

const KEYS: readonly (readonly [string, LanguageCommand | "back"])[] = [
  ["F12", "definition"],
  ["Shift-F12", "references"],
  ["Mod-Shift-o", "symbols"],
  ["Alt-ArrowLeft", "back"],
];

export const languageKeys = (run: (command: LanguageCommand | "back") => void) =>
  keymap.of(
    KEYS.map(([key, command]) => ({
      key,
      run: () => {
        run(command);

        return true;
      },
    }))
  );
