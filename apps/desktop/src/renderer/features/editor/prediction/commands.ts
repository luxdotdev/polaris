import { useEffect } from "react";
import { useCommands } from "../../../shell/hooks.ts";
import { getActiveEditor } from "../runtime/hooks.ts";
import { acceptPrediction, setGhost, visibleGhost } from "./index.ts";

/** Availability is read from the focused view, including popup and snippet suppression. */
export const usePredictionCommands = () => {
  const registry = useCommands();
  useEffect(() => {
    const available = () => {
      const view = getActiveEditor()?.view;

      return view !== undefined && view.hasFocus && visibleGhost(view.state) !== null;
    };

    const accept = (word: boolean) => {
      const view = getActiveEditor()?.view;

      if (view) acceptPrediction(view, word);
    };

    const unregister = registry.register({
      "editor.prediction.accept": { enabled: available, run: () => accept(false) },
      "editor.prediction.acceptWord": { enabled: available, run: () => accept(true) },
      "editor.prediction.dismiss": {
        enabled: available,
        run: () => {
          const view = getActiveEditor()?.view;

          if (view) view.dispatch({ effects: setGhost.of(null) });
        },
      },
    });

    const unprovide = registry.provide(() => ({ keys: available() ? ["prediction.ghost"] : [] }));

    return () => {
      unregister();
      unprovide();
    };
  }, [registry]);
};
