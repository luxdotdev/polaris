/**
 * The pairing strings the user pasted, kept in Raycast's LocalStorage as one
 * JSON list, in the order the SDK tries them.
 */
import { type ParsedPairing, parsePairing } from "@polaris/sdk";
import { Option, Schema } from "effect";

/** Raycast's `LocalStorage`, or a Map in tests. */
export interface PairingStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
}

export interface StoredPairing {
  readonly text: string;
  readonly pairing: ParsedPairing;
}

const KEY = "pairings";

const decodeList = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)));

const parsed = (text: string): ReadonlyArray<StoredPairing> => {
  try {
    return [{ text, pairing: parsePairing(text) }];
  } catch {
    return [];
  }
};

/** What is stored; anything unreadable is skipped. */
export const readPairings = async (
  storage: PairingStorage
): Promise<ReadonlyArray<StoredPairing>> => {
  const raw = await storage.getItem(KEY);
  const texts = raw === undefined ? [] : Option.getOrElse(decodeList(raw), () => []);

  return texts.flatMap(parsed);
};

const write = (storage: PairingStorage, pairings: ReadonlyArray<StoredPairing>) =>
  storage.setItem(KEY, JSON.stringify(pairings.map((p) => p.text)));

/** One Host reached the same way: a new pairing for it replaces the old one. */
const sameRoute = (a: ParsedPairing, b: ParsedPairing) =>
  a.token === b.token || (a.hostId === b.hostId && a.url === b.url);

/**
 * Adds a pasted pairing string; throws `InvalidPairing` when it can't be read.
 * `replaced` when it took the place of an older pairing to the same Host and route.
 */
export const addPairing = async (
  storage: PairingStorage,
  text: string
): Promise<{ readonly added: StoredPairing; readonly replaced: boolean }> => {
  const added = { text: text.trim(), pairing: parsePairing(text) };
  const current = await readPairings(storage);
  const at = current.findIndex((p) => sameRoute(p.pairing, added.pairing));
  const next = at === -1 ? [...current, added] : current.with(at, added);

  await write(storage, next);

  return { added, replaced: at !== -1 };
};

export const removePairing = async (storage: PairingStorage, token: string): Promise<void> => {
  const current = await readPairings(storage);

  await write(
    storage,
    current.filter((p) => p.pairing.token !== token)
  );
};

/** A pairing over the Daemon's socket, or the gateway on this Mac, reaches a Host on this Mac. */
export const isLocal = (pairing: ParsedPairing): boolean => {
  if (pairing.url === null) return true;

  const host = URL.parse(pairing.url)?.hostname ?? "";

  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
};
