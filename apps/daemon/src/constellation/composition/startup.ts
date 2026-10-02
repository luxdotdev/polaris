import { existsSync } from "node:fs";
import type { ReadModel } from "../../store/model.ts";
import { Effect } from "effect";

export const constellationTransferPath = (root: string) => `${root}/constellation-transfers.sqlite`;

/** No transfer database is opened or created for a Daemon that has never used Constellations. */
export const needsConstellationStartup = (root: string, model: ReadModel) =>
  Effect.gen(function* () {
    if (model.constellations.size !== 0) return true;
    const path = constellationTransferPath(root);

    if (!existsSync(path)) return false;
    const { Database } = yield* Effect.promise(() => import("bun:sqlite"));

    return yield* Effect.sync(() => {
      const db = new Database(path, { readonly: true });

      try {
        return db.query("SELECT 1 FROM assignments LIMIT 1").get() !== null;
      } finally {
        db.close();
      }
    });
  });
