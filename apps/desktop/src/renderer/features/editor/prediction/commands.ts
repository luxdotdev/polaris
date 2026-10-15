import { useEffect } from "react";
import { useCommands } from "../../../shell/hooks.ts";
import { getActiveEditor } from "../runtime/hooks.ts";
import {
  acceptAnyPrediction,
  setEditPrediction,
  setGhost,
  showLastEditPrediction,
  visibleEditPrediction,
  visibleGhost,
} from "./index.ts";

/** Availability is read from the focused view, including popup and snippet suppression. */
export const usePredictionCommands = () => {
  const registry = useCommands();
  useEffect(() => {
    const focused = () => {
      const view = getActiveEditor()?.view;

      return view !== undefined && view.hasFocus ? view : undefined;
    };

    const available = () => {
      const view = focused();

      return (
        view !== undefined &&
        (visibleGhost(view.state) !== null || visibleEditPrediction(view.state) !== null)
      );
    };

    const acceptable = () => {
      const view = focused();

      return available() && view !== undefined && !visibleGhost(view.state)?.provisional;
    };

    const accept = (word: boolean) => {
      const view = focused();

      if (view) acceptAnyPrediction(view, word);
    };

    const unregister = registry.register({
      "editor.prediction.accept": { enabled: acceptable, run: () => accept(false) },
      "editor.prediction.acceptWord": { enabled: acceptable, run: () => accept(true) },
      "editor.prediction.dismiss": {
        enabled: available,
        run: () => {
          const view = focused();

          if (view) view.dispatch({ effects: [setGhost.of(null), setEditPrediction.of(null)] });
        },
      },
      "editor.prediction.showLast": {
        enabled: () => getActiveEditor()?.view !== undefined,
        run: () => {
          const view = getActiveEditor()?.view;

          if (view) showLastEditPrediction(view);
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
