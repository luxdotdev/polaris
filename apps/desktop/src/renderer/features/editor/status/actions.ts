/**
 * What the popover's rows do, through the existing language RPCs. Failures come back as the
 * typed `LanguageError` for the popover to show inline; nothing here raises a toast.
 */
import * as P from "@polaris/protocol";
import { Match, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { languageIpcError } from "../../../../shared/languageError.ts";
import { changeTrust } from "../trust/decide.ts";
import type { TrustStatus } from "../trust/model.ts";
import { snapshotsObserved } from "./feed.ts";
import type { ActionId } from "./model.ts";

export interface ActionTarget {
  readonly hostKey: string;
  readonly path: string;
  readonly checkout: P.LanguageCheckout | null;
  readonly providerId: string | null;
  readonly trust: TrustStatus | null;
  readonly contextAcquired?: boolean;
}

export interface ActionPorts {
  readonly api: LanguageApi | undefined;
  readonly recheck: () => Promise<void>;
  readonly showLog: () => void;
  readonly openSettings: () => void;
}

const unavailable = () =>
  new P.LanguageError({
    reason: "not-connected",
    message: "Language tooling is unavailable.",
    retryable: true,
  });

export const restartServer = async (api: LanguageApi, target: ActionTarget) => {
  if (target.checkout === null || target.providerId === null) throw unavailable();

  const reply = await api.request("languages.server.restart", {
    hostKey: target.hostKey,
    checkout: target.checkout,
    providerId: target.providerId,
  });

  if (!reply.ok) throw languageIpcError(reply.error);
  snapshotsObserved(
    target.hostKey,
    Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(reply.value)
  );
};

const trustChange = async (
  api: LanguageApi,
  target: ActionTarget,
  action: typeof P.LanguageTrustAction.Type
) => {
  if (target.checkout === null || target.trust === null) throw unavailable();
  await changeTrust(
    api,
    { hostKey: target.hostKey, checkout: target.checkout, path: target.path },
    action,
    target.trust.trust.revision
  );
};

/** Runs one popover row; resolves when the Daemon answered, rejects with a `LanguageError`. */
export const runAction = async (id: ActionId, target: ActionTarget, ports: ActionPorts) => {
  const api = ports.api;

  await Match.value(id).pipe(
    Match.when("show-log", async () => ports.showLog()),
    Match.when("settings", async () => ports.openSettings()),
    Match.when("check-again", async () => ports.recheck()),
    Match.orElse(async (remote) => {
      if (api === undefined) throw unavailable();

      return Match.value(remote).pipe(
        Match.when("restart", async () => {
          if (target.providerId !== null) await restartServer(api, target);

          if (target.providerId === null || target.contextAcquired === false) await ports.recheck();
        }),
        // "Trust {workspace}…" brings the Trust card back with what would run.
        Match.when("trust", () => trustChange(api, target, "ask-again")),
        Match.when("use-bundled", () => trustChange(api, target, "use-bundled")),
        Match.when("use-project", () => trustChange(api, target, "use-project")),
        Match.orElse(() => Promise.resolve())
      );
    })
  );
};
