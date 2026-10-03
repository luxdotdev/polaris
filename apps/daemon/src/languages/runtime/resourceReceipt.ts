import { LanguageServerResponse } from "@polaris/protocol";
import { Schema } from "effect";
import { LanguageResourceReceiptChallenge } from "@polaris/protocol";
import type { LanguageContextIdentity } from "@polaris/protocol";
import type { CanonicalCheckout } from "../trust/index.ts";
import { checkoutKey } from "../trust/index.ts";
import { failure } from "../transport/framing.ts";
import type { Entry } from "./types.ts";

/** A private challenge retains the exact broker entry and bridge across the Client response wait. */
export const bindResourceReceipt =
  (
    owned: (clientId: string, context: LanguageContextIdentity) => Entry,
    trusted: (entry: Entry) => Promise<CanonicalCheckout>
  ) =>
  async (
    clientId: string,
    context: LanguageContextIdentity,
    challenge: LanguageResourceReceiptChallenge,
    signal: AbortSignal
  ) => {
    const entry = owned(clientId, context);
    await trusted(entry);
    const bridge = entry.bridge;

    if (bridge === undefined) throw failure("not-ready", "Language connection not ready");
    const result = await bridge.challengeReceipt(challenge, signal);

    if (owned(clientId, context) !== entry || entry.bridge !== bridge || signal.aborted)
      throw failure("stale-generation", "Receipt context changed");
    await trusted(entry);

    if (owned(clientId, context) !== entry || entry.bridge !== bridge || signal.aborted)
      throw failure("stale-generation", "Receipt context changed");

    return result;
  };

export const bindServerResponse =
  (
    owned: (clientId: string, context: LanguageContextIdentity) => Entry,
    trusted: (entry: Entry) => Promise<CanonicalCheckout>
  ) =>
  async (clientId: string, input: typeof LanguageServerResponse.Type) => {
    const valid = Schema.decodeUnknownSync(LanguageServerResponse)(input);
    const entry = owned(clientId, valid.context);
    await trusted(entry);

    if (entry.bridge === undefined) throw failure("not-ready", "Language connection not ready");
    await entry.bridge.respond(valid);
  };

/** Historical recovery selects only an existing live feed for the same authenticated checkout owner. */
export const bindRecoveryReceipt =
  (
    entries: () => Iterable<Entry>,
    owned: (clientId: string, context: LanguageContextIdentity) => Entry,
    trusted: (entry: Entry) => Promise<CanonicalCheckout>
  ) =>
  async (
    clientId: string,
    historical: LanguageContextIdentity,
    challenge: LanguageResourceReceiptChallenge,
    signal: AbortSignal
  ) => {
    if (clientId !== historical.clientId) throw failure("not-owner", "Recovery owner changed");

    const candidates = [...entries()].filter(
      (entry) =>
        entry.identity.clientId === clientId &&
        entry.identity.hostId === historical.hostId &&
        checkoutKey(entry.identity.checkout) === checkoutKey(historical.checkout) &&
        entry.identity.checkout.path === historical.checkout.path &&
        entry.bridge !== undefined &&
        entry.events.hasSubscribers()
    );

    const selected =
      candidates.find((entry) => entry.identity.contextId === historical.contextId) ??
      candidates[0];

    if (selected === undefined) throw failure("not-ready", "Current recovery feed is unavailable");

    if (!Schema.is(LanguageResourceReceiptChallenge.cases.Recover)(challenge))
      throw failure("invalid-input", "Historical routing permits only recovery challenges");

    return bindResourceReceipt(owned, trusted)(clientId, selected.identity, challenge, signal);
  };
