import { expect, test } from "bun:test";
import { type DraftStore, draftKey, draftWriter } from "./draftWriter.ts";

const DELAY = 20;

/** A Map behind the store's boundary, as SecureStore keeps it. */
const memoryStore = () => {
  const kept = new Map<string, string>();

  const store: DraftStore = {
    load: (key) => Promise.resolve(kept.get(key) ?? null),
    save: (key, text) => {
      if (text.trim() === "") kept.delete(key);
      else kept.set(key, text);

      return Promise.resolve();
    },
  };

  return { kept, store };
};

const polaris = draftKey({ hostId: "mac/studio 1", workspaceId: "polaris" });

const dcai = draftKey({ hostId: "lucas-rpi", workspaceId: "dcai" });

test("each host and workspace keeps its own draft under a key SecureStore accepts", () => {
  const keys = [
    polaris,
    dcai,
    draftKey({ hostId: "mac/studio 1", workspaceId: "dcai" }),
    draftKey({ hostId: "lucas-rpi", workspaceId: "polaris" }),
  ];

  expect(new Set(keys).size).toBe(4);
  expect(draftKey({ hostId: "mac/studio 1", workspaceId: "polaris" })).toBe(polaris);

  for (const key of keys) expect(key).toMatch(/^[\w.-]+$/);
});

test("typing waits for a pause, then writes only the latest text", async () => {
  const { kept, store } = memoryStore();
  const writer = draftWriter(store, () => undefined, DELAY);

  writer.write(polaris, "Fix the");
  writer.write(polaris, "Fix the relay");
  expect(kept.size).toBe(0);

  await Bun.sleep(DELAY * 3);

  expect(kept.get(polaris)).toBe("Fix the relay");
});

test("switching place before the pause still keeps the first place's draft", async () => {
  const { kept, store } = memoryStore();
  const saved: Array<string> = [];
  const writer = draftWriter(store, (key) => saved.push(key), DELAY);

  writer.write(polaris, "Fix the relay reconnect");
  writer.write(dcai, "Retrain");
  await Bun.sleep(0);

  expect(kept.get(polaris)).toBe("Fix the relay reconnect");
  expect(kept.has(dcai)).toBe(false);

  await writer.flush();

  expect(kept.get(dcai)).toBe("Retrain");
  expect(saved).toEqual([polaris, dcai]);
});

test("after the first send, that place's draft is forgotten and a pending write never lands", async () => {
  const { kept, store } = memoryStore();
  const writer = draftWriter(store, () => undefined, DELAY);

  writer.write(dcai, "Retrain");
  await writer.flush();
  writer.write(polaris, "Fix the relay");
  await writer.clear(polaris);
  await Bun.sleep(DELAY * 3);

  expect(kept.has(polaris)).toBe(false);
  expect(kept.get(dcai)).toBe("Retrain");
});
