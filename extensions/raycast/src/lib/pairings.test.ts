import { expect, test } from "bun:test";
import { encodePairing, InvalidPairing, type ParsedPairing } from "@polaris/sdk";
import {
  addPairing,
  isLocal,
  type PairingStorage,
  readPairings,
  removePairing,
} from "./pairings.ts";

const memory = (initial?: string): PairingStorage & { readonly raw: () => string | undefined } => {
  const items = new Map<string, string>(initial === undefined ? [] : [["pairings", initial]]);

  return {
    getItem: async (key) => items.get(key),
    setItem: async (key, value) => {
      items.set(key, value);
    },
    raw: () => items.get("pairings"),
  };
};

const pairing = (fields: Partial<ParsedPairing>): ParsedPairing => ({
  hostId: "mac",
  hostName: "Mac Studio",
  url: null,
  token: "pol_ext_1",
  name: "Raycast",
  ...fields,
});

const tokens = async (storage: PairingStorage) =>
  (await readPairings(storage)).map((stored) => stored.pairing.token);

test("a pasted pairing string is kept, trimmed, and read back", async () => {
  const storage = memory();
  const text = encodePairing(pairing({}));
  const { added, replaced } = await addPairing(storage, `  ${text}\n`);

  expect([added.text, added.pairing.hostName, replaced]).toEqual([text, "Mac Studio", false]);
  expect(storage.raw()).toBe(JSON.stringify([text]));
});

test("a string that isn't a pairing is refused with the reason and nothing is stored", async () => {
  const storage = memory();

  const refused = await addPairing(storage, "pol_ext_123").then(
    () => null,
    (error: Error) => error
  );

  expect(refused).toBeInstanceOf(InvalidPairing);
  expect(refused?.message).toContain("polaris-pair:v1:");
  expect(storage.raw()).toBeUndefined();
});

test("pairing a Host again over the same route replaces the old pairing in place", async () => {
  const storage = memory();

  await addPairing(storage, encodePairing(pairing({ token: "old" })));
  await addPairing(
    storage,
    encodePairing(pairing({ token: "gateway", url: "wss://mac.ts.net/polaris/rpc" }))
  );
  const { replaced } = await addPairing(storage, encodePairing(pairing({ token: "new" })));

  expect(replaced).toBe(true);
  expect(await tokens(storage)).toEqual(["new", "gateway"]);
});

test("a removed pairing is gone and the others stay", async () => {
  const storage = memory();

  await addPairing(storage, encodePairing(pairing({ token: "a", hostId: "mac" })));
  await addPairing(storage, encodePairing(pairing({ token: "b", hostId: "pi" })));
  await removePairing(storage, "a");

  expect(await tokens(storage)).toEqual(["b"]);
});

test("unreadable storage and entries are skipped, not thrown", async () => {
  expect(await tokens(memory("not json"))).toEqual([]);
  expect(await tokens(memory(JSON.stringify(["junk", encodePairing(pairing({}))])))).toEqual([
    "pol_ext_1",
  ]);
});

test.each([
  [null, true],
  ["ws://127.0.0.1:7477/polaris/rpc", true],
  ["ws://localhost:7477/polaris/rpc", true],
  ["wss://mac-studio.tail1234.ts.net/polaris/rpc", false],
])("a pairing at %s is on this Mac: %p", (url, local) => {
  expect(isLocal(pairing({ url }))).toBe(local);
});
