/** The language commands' keys while the code has focus (`navigation/commands.ts`). */
import { keymap } from "@codemirror/view";
import { LANGUAGE_NAVIGATION, type NavigationAction } from "../navigation/commands.ts";

export const languageKeys = (run: (action: NavigationAction) => void) =>
  keymap.of(
    LANGUAGE_NAVIGATION.flatMap((command) =>
      command.key === undefined
        ? []
        : [
            {
              key: command.key,
              run: () => {
                run(command.action);

                return true;
              },
            },
          ]
    )
  );
