import { useEffect } from "react";
import { refreshLanguageSettings } from "../../editor/api.ts";
import { setLanguageSettingsServices } from "./services.ts";

/** Refresh existing Editor lifetimes only after Settings receives a matching committed acknowledgement. */
export const LanguageSettingsBindings = () => {
  useEffect(
    () =>
      setLanguageSettingsServices({
        refreshLanguageSettings,
        refreshMarkdownPolicy: (hostKey, workspaceId) => {
          void import("../../editor/runtime/actions.ts").then((actions) =>
            actions.refreshMarkdownPolicy(hostKey, workspaceId)
          );
        },
      }),
    []
  );

  return null;
};
