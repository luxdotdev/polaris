import { predictionStore } from "../editor/prediction/store.ts";
import { createElement } from "react";
/** Relay notices reuse the app's Polaris toast and its Undo action (DESIGN.md, Toasts). */
import { PixelCheckIcon, PixelFailedIcon, showToast } from "@polaris/ui";
import type { PolarisApi } from "../../../shared/api.ts";
import type { SessionId } from "@polaris/protocol";

export const connectClientSettingNotices = (api: PolarisApi) =>
  api.onAppEvent((event) => {
    if (event.kind === "client-prediction")
      predictionStore.setState((state) => ({
        enabled: event.enabled,
        configured: event.configured,
        clientEndpoints: event.clientEndpoints,
        revision: state.revision + 1,
      }));

    if (event.kind === "prediction-settings")
      predictionStore.setState((state) => ({
        preferences: { ...state.preferences, [event.hostKey]: event.preferences },
        revision: state.revision + 1,
      }));

    if (event.kind !== "client-settings-changed") return;
    showToast({
      source: "starlight",
      icon: createElement(PixelCheckIcon, { size: 16 }),
      title: `Changed ${event.key}`,
      message: `An agent changed this client setting to ${JSON.stringify(event.value)}.`,
      action: {
        label: "Undo",
        onAction: () => {
          void api.request("clientSettings.undo", { requestId: event.requestId }).then((result) => {
            if (!result.ok)
              showToast({
                source: "starlight",
                icon: createElement(PixelFailedIcon, { size: 16 }),
                title: "Couldn't undo the setting",
                message: result.error.message,
              });
          });
        },
      },
    });
  });

interface Navigation {
  getState: () => { hostKey: string | null; sessionId: SessionId | null; pane: string };
  subscribe: (listener: () => void) => () => void;
}

/** Activity is sent on selection and window focus changes, with no polling. */
export const reportClientSettingsActivity = (api: PolarisApi, navigation: Navigation) => {
  const report = () => {
    const state = navigation.getState();
    void api.request("clientSettings.activity", {
      hostKey: state.hostKey,
      sessionId: state.pane === "session" ? state.sessionId : null,
      active: document.hasFocus(),
    });
  };

  report();
  const stop = navigation.subscribe(report);
  window.addEventListener("focus", report);
  window.addEventListener("blur", report);

  return () => {
    stop();
    window.removeEventListener("focus", report);
    window.removeEventListener("blur", report);
  };
};
