/** What each of the card's actions does; all of them reuse the Settings page's store functions. */
import type { PredictionServerReport } from "@polaris/protocol";
import { Match } from "effect";
import type { PolarisApi } from "../../../../../shared/api.ts";
import { writeClipboard } from "../../../clipboard.ts";
import {
  checkPredictionAgain,
  managedAction,
  setHostPreferences,
  setPredictionEnabled,
  turnOnDiscoveredServer,
} from "../store.ts";
import { serverRequest } from "./hooks.ts";
import { LLAMA_SERVER_COMMAND, type CardAction, type CompletionCardView } from "./model.ts";

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
    Match.whenOr("set-up", "retry-setup", async () => {
      if (view.managed !== null) await managedAction(api, hostKey, view.managed.side, "setup");

      return null;
    }),
    Match.when("cancel-download", async () => {
      if (view.managed !== null) await managedAction(api, hostKey, view.managed.side, "cancel");

      return null;
    }),
    Match.when("copy-command", async () => {
      if (!(await writeClipboard(LLAMA_SERVER_COMMAND))) throw new Error("Couldn't copy");

      return "Copied the llama-server command.";
    }),
    Match.when("remove-model", async () => {
      if (view.managed !== null) await managedAction(api, hostKey, view.managed.side, "remove");

      return "Removed the downloaded model.";
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
