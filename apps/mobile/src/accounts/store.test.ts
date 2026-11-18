import { expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { type Keychain, keychainAccountStore } from "./store.ts";

const memoryKeychain = () => {
  const items = new Map<string, string>();

  const keychain: Keychain = {
    get: async (key) => items.get(key) ?? null,
    set: async (key, value) => void items.set(key, value),
    delete: async (key) => void items.delete(key),
  };

  return { items, keychain };
};

test("a token is kept under its Account's own key and goes when deleted", async () => {
  const { items, keychain } = memoryKeychain();
  const store = keychainAccountStore(keychain);

  await Effect.runPromise(store.setToken("a1", "t1"));
  await Effect.runPromise(store.setToken("b2", "t2"));
  await Effect.runPromise(store.deleteToken("a1"));

  expect([...items.keys()]).toEqual(["polaris.accounts.token.b2"]);
  expect(Option.getOrNull(await Effect.runPromise(store.token("b2")))).toBe("t2");
  expect(Option.isNone(await Effect.runPromise(store.token("a1")))).toBe(true);
});

test("a list the Keychain can't decode reads as no Polaris accounts", async () => {
  const { items, keychain } = memoryKeychain();
  items.set("polaris.accounts.list", "{not json");

  expect(await Effect.runPromise(keychainAccountStore(keychain).read)).toEqual({
    accounts: [],
    workspaces: {},
  });
});

test("a refusing Keychain fails as storage, not as an empty list", async () => {
  const store = keychainAccountStore({
    get: () => Promise.reject(new Error("locked")),
    set: () => Promise.reject(new Error("locked")),
    delete: () => Promise.reject(new Error("locked")),
  });

  const failure = await Effect.runPromise(Effect.flip(store.read));

  expect(failure.reason).toBe("storage");
});
