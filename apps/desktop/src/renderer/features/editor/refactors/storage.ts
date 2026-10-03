import { Schema } from "effect";
import { decodeGroup, encodeGroup, type DraftGroup, type GroupStore } from "./group.ts";

/** Dedicated database: opening existing Editor spill storage never changes its schema/version. */
export const indexedDbGroups = (): GroupStore => {
  let pending: Promise<IDBDatabase> | null = null;

  const database = () => {
    pending ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("polaris-editor-refactors", 1);
      req.addEventListener("upgradeneeded", () => req.result.createObjectStore("groups"));
      req.addEventListener("success", () => resolve(req.result));
      req.addEventListener("error", () => {
        pending = null;
        reject(req.error);
      });
    });

    return pending;
  };

  const read = async (id: string | null): Promise<readonly DraftGroup[]> => {
    const db = await database();

    return new Promise((resolve, reject) => {
      const tx = db.transaction("groups", "readonly");

      const req =
        id === null ? tx.objectStore("groups").getAll() : tx.objectStore("groups").get(id);

      let groups: DraftGroup[] = [];
      req.addEventListener("success", () => {
        try {
          const values: unknown = req.result;

          // SAFETY: IndexedDB getAll returns an array; each stored value is decoded below.
          const list =
            id === null
              ? Schema.decodeUnknownSync(Schema.Array(Schema.String))(values)
              : values === undefined
                ? []
                : [values];

          groups = list.map((value) => {
            return decodeGroup(Schema.decodeUnknownSync(Schema.String)(value));
          });
        } catch (cause) {
          reject(cause);
        }
      });
      tx.addEventListener("complete", () => resolve(groups));
      tx.addEventListener("abort", () => reject(tx.error ?? new Error("Draft read aborted")));
      tx.addEventListener("error", () => reject(tx.error));
    });
  };

  return {
    get: async (id) => (await read(id))[0] ?? null,
    list: () => read(null),
    commit: async (group, expectedRevision) => {
      const encoded = encodeGroup(group);
      const db = await database();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("groups", "readwrite", { durability: "strict" });

        if (tx.durability !== "strict") {
          tx.abort();
          reject(new Error("Strict draft durability is unavailable."));

          return;
        }

        const store = tx.objectStore("groups");
        const req = store.get(group.id);
        req.addEventListener("success", () => {
          try {
            const value: unknown = req.result;

            const prior =
              value === undefined
                ? null
                : decodeGroup(Schema.decodeUnknownSync(Schema.String)(value));

            if (
              (prior?.revision ?? null) !== expectedRevision ||
              group.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)
            )
              throw new Error("Draft group changed in another window.");
            store.put(encoded, group.id);
          } catch (cause) {
            tx.abort();
            reject(cause);
          }
        });
        tx.addEventListener("complete", () => resolve());
        tx.addEventListener("abort", () =>
          reject(tx.error ?? new Error("Draft transaction aborted"))
        );
        tx.addEventListener("error", () => reject(tx.error));
      });
    },
  };
};

/** Same serialization/CAS contract in fake-Host fixtures; not a durability certification. */
export const memoryGroups = (): GroupStore => {
  const groups = new Map<string, string>();

  return {
    get: (id) => Promise.resolve(groups.has(id) ? decodeGroup(groups.get(id)!) : null),
    list: () => Promise.resolve([...groups.values()].map(decodeGroup)),
    commit: (group, expectedRevision) => {
      const prior = groups.get(group.id);

      if (
        (prior === undefined ? null : decodeGroup(prior).revision) !== expectedRevision ||
        group.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)
      )
        return Promise.reject(new Error("Draft group revision changed"));
      groups.set(group.id, encodeGroup(group));

      return Promise.resolve();
    },
  };
};
