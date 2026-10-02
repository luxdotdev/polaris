/** Big drafts' text in IndexedDB (`polaris-editor` / `drafts`), keyed like their localStorage stubs. */
import { Option, Schema } from "effect";
import type { SpillStore } from "../model/draftStore.ts";

const decodeText = Schema.decodeUnknownOption(Schema.String);

const DB = "polaris-editor";

const STORE = "drafts";

const request = <A>(req: IDBRequest<A>) =>
  new Promise<A>((resolve, reject) => {
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error ?? new Error("IndexedDB request failed")));
  });

let opened: Promise<IDBDatabase> | null = null;

const database = () => {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB, 1);

    open.addEventListener("upgradeneeded", () => open.result.createObjectStore(STORE));
    open.addEventListener("success", () => resolve(open.result));
    open.addEventListener("error", () => {
      opened = null;
      reject(open.error ?? new Error("IndexedDB didn't open"));
    });
  });

  return opened;
};

const store = async (mode: IDBTransactionMode) =>
  (await database()).transaction(STORE, mode).objectStore(STORE);

/** Null where IndexedDB isn't available; drafts then stay within localStorage's budget. */
export const indexedDbSpill = (): SpillStore | null =>
  typeof indexedDB === "undefined"
    ? null
    : {
        get: async (key) => {
          const value: unknown = await request((await store("readonly")).get(key));

          return Option.getOrNull(decodeText(value));
        },
        put: async (key, text) => {
          await request((await store("readwrite")).put(text, key));
        },
        delete: async (key) => {
          await request((await store("readwrite")).delete(key));
        },
      };
