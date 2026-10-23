import { expect, test } from "bun:test";
import { encodePairing } from "@polaris/sdk";
import { addPairing, loadPairings, removeHost, savePairings, STORAGE_KEY } from "./pairings.ts";

const pairing = (hostId: string, url: string | null, token = "t") =>
  encodePairing({ hostId, hostName: `Host ${hostId}`, url, token, name: "Even G2" });

const memory = () => {
  const items = new Map<string, string>();

  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    items,
  };
};

test("a newer pairing for the same Host and address replaces the old one", () => {
  const url = "wss://mac.example.ts.net/polaris/rpc";
  const first = addPairing([], pairing("h1", url, "old"));
  const other = first.ok ? addPairing(first.stored, pairing("h2", url)) : first;
  const second = other.ok ? addPairing(other.stored, pairing("h1", url, "new")) : other;

  if (!second.ok) throw new Error(second.error);
  expect(second.stored.map((s) => [s.pairing.hostId, s.pairing.token])).toEqual([
    ["h2", "t"],
    ["h1", "new"],
  ]);
  expect(removeHost(second.stored, "h1").map((s) => s.pairing.hostId)).toEqual(["h2"]);
});

test("refuses text that isn't a pairing, and a pairing for the local socket", () => {
  expect(addPairing([], "hello")).toEqual({
    ok: false,
    error: "That isn't a Polaris pairing string.",
  });
  const local = addPairing([], pairing("h1", null));

  expect(local.ok ? "" : local.error).toContain("turn on remote access");
});

test("survives a reload, and ignores what it can't read", () => {
  const storage = memory();
  const added = addPairing([], pairing("h1", "wss://mac.example.ts.net/polaris/rpc"));

  if (!added.ok) throw new Error(added.error);
  savePairings(storage, added.stored);
  expect(loadPairings(storage).map((s) => s.pairing.hostId)).toEqual(["h1"]);

  storage.items.set(STORAGE_KEY, JSON.stringify(["garbage", added.stored[0]?.text]));
  expect(loadPairings(storage)).toHaveLength(1);
  storage.items.set(STORAGE_KEY, "{not json");
  expect(loadPairings(storage)).toEqual([]);
});
