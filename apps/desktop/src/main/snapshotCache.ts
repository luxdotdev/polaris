/**
 * The renderer's last synchronized Host snapshots, kept in
 * `<userData>/cache/hosts.json` so the next launch paints at once and then
 * revalidates against the live feed (ENG-175). Losing it only costs that first paint.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { CachedHost } from "../shared/contract.ts";

const CacheFile = Schema.Struct({ version: Schema.Literal(1), hosts: Schema.Array(CachedHost) });

const decodeCache = Schema.decodeUnknownOption(Schema.fromJsonString(CacheFile));

const encodeCache = Schema.encodeSync(Schema.fromJsonString(CacheFile));

export interface SnapshotCache {
  readonly get: () => ReadonlyArray<CachedHost>;
  readonly put: (host: CachedHost) => void;
}

export const openSnapshotCache = (userData: string): SnapshotCache => {
  const dir = join(userData, "cache");
  const path = join(dir, "hosts.json");

  let hosts: ReadonlyArray<CachedHost> = existsSync(path)
    ? Option.match(decodeCache(readFileSync(path, "utf8")), {
        onNone: () => [],
        onSome: (file) => file.hosts,
      })
    : [];

  return {
    get: () => hosts,
    put: (host) => {
      hosts = [...hosts.filter((h) => h.hostKey !== host.hostKey), host];
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${path}.part`, encodeCache({ version: 1, hosts }));
      renameSync(`${path}.part`, path);
    },
  };
};
