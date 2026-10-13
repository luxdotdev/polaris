/** What each of the card's actions does; all of them reuse the Settings page's store functions. */
import type { PredictionServerReport } from "@polaris/protocol";
import { Match } from "effect";
import type { PolarisApi } from "../../../../../shared/api.ts";
import {
  checkPredictionAgain,
  setHostPreferences,
  setPredictionEnabled,
  turnOnDiscoveredServer,
} from "../store.ts";
import { serverRequest } from "./hooks.ts";
import type { CardAction, CompletionCardView } from "./model.ts";

export interface ActionPorts {
  readonly api: PolarisApi;
  readonly hostKey: string;
  readonly view: CompletionCardView;
  readonly openSettings: () => void;
  /** The server's report after a recovery action, so the card shows it at once. */
  readonly remember: (report: PredictionServerReport) => void;
}

/** Runs one action; resolves to the outcome line to show, or null for none. */
export const runCardAction = (action: CardAction, ports: ActionPorts): Promise<string | null> => {
  const { api, hostKey, view } = ports;

  return Match.value(action.id).pipe(
    Match.when("settings", async () => {
      ports.openSettings();

      return null;
    }),
    Match.when("turn-on", async () => {
      if (view.kind === "offer") await turnOnDiscoveredServer(api, hostKey);
      else await setPredictionEnabled(api, true);

      return null;
    }),
    Match.when("turn-on-host", async () => {
      await setHostPreferences(api, hostKey, { placement: "auto" });

      return null;
    }),
    Match.when("turn-off-host", async () => {
      await setHostPreferences(api, hostKey, { placement: "off" });

      return null;
    }),
    Match.when("check-again", async () => {
      await checkPredictionAgain(api, hostKey);

      return null;
    }),
    Match.orElse(async (id) => {
      if (view.target === null) return null;
      const report = await serverRequest(api, hostKey, view.target, id);
      ports.remember(report);
      // A recovered server gets a fresh start: the old failure no longer describes it.
      await checkPredictionAgain(api, hostKey);

      return report.outcome === null ? null : `${report.outcome}.`;
    })
  );
};
