/**
 * The pairing strings this WebView keeps, in its localStorage: read back on
 * every launch, one or more per Host.
 */
import { decodePairing, type ParsedPairing } from "@polaris/sdk";
import { Effect, Exit, Option, Schema } from "effect";

export const STORAGE_KEY = "polaris.pairings";

export interface Stored {
  readonly text: string;
  readonly pairing: ParsedPairing;
}

const parse = (text: string): ParsedPairing | null => {
  const exit = Effect.runSyncExit(decodePairing(text.trim()));

  return Exit.isSuccess(exit) ? exit.value : null;
};

const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)));

export const loadPairings = (storage: Pick<Storage, "getItem">): ReadonlyArray<Stored> =>
  Option.getOrElse(decodeStored(storage.getItem(STORAGE_KEY) ?? "[]"), () => []).flatMap((text) => {
    const pairing = parse(text);

    return pairing === null ? [] : [{ text, pairing }];
  });

export const savePairings = (storage: Pick<Storage, "setItem">, stored: ReadonlyArray<Stored>) =>
  storage.setItem(STORAGE_KEY, JSON.stringify(stored.map((entry) => entry.text)));

export type AddResult =
  | { readonly ok: true; readonly stored: ReadonlyArray<Stored>; readonly added: ParsedPairing }
  | { readonly ok: false; readonly error: string };

/** Adds a pasted or scanned pairing; a new one for the same Host and address replaces the old. */
export const addPairing = (stored: ReadonlyArray<Stored>, input: string): AddResult => {
  const text = input.trim();
  const pairing = parse(text);

  if (pairing === null) return { ok: false, error: "That isn't a Polaris pairing string." };

  if (pairing.url === null)
    return {
      ok: false,
      error: `This pairing is for apps on ${pairing.hostName} itself. In Polaris, turn on remote access and pair again.`,
    };

  const others = stored.filter(
    (entry) => entry.pairing.hostId !== pairing.hostId || entry.pairing.url !== pairing.url
  );

  return { ok: true, stored: [...others, { text, pairing }], added: pairing };
};

export const removeHost = (stored: ReadonlyArray<Stored>, hostId: string) =>
  stored.filter((entry) => entry.pairing.hostId !== hostId);
