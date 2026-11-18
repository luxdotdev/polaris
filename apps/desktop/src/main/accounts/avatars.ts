/**
 * Polaris accounts' avatars, fetched by the main process (the renderer's CSP blocks remote
 * images) and kept as data URLs in memory and under `<userData>/accounts/avatars/<id>.json`.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import type { InternetFetch } from "../net.ts";

const Cached = Schema.Struct({ url: Schema.String, data: Schema.String });

const decodeCached = Schema.decodeUnknownOption(Schema.fromJsonString(Cached));

/** Avatars beyond this are refused; GitHub's are a few KB. */
const MAX_BYTES = 512 * 1024;

const IMAGE = /^image\/(png|jpeg|gif|webp)$/;

const dataUrl = async (fetch: InternetFetch, url: string) => {
  const response = await fetch(url);
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";

  if (!response.ok || !IMAGE.test(type)) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());

  return bytes.byteLength > MAX_BYTES
    ? null
    : `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
};

export const avatarCache = (dir: string, fetch: InternetFetch) => {
  const cached = new Map<string, typeof Cached.Type>();
  /** Accounts whose avatar was tried for this URL already (fetched, failed, or read from disk). */
  const tried = new Map<string, string>();
  const path = (id: string) => join(dir, `${id}.json`);

  const fromDisk = (id: string, url: string) =>
    Effect.promise(() => readFile(path(id), "utf8").catch(() => "")).pipe(
      Effect.map((text) => Option.filter(decodeCached(text), (c) => c.url === url))
    );

  const fromNetwork = (id: string, url: string) =>
    Effect.promise(async () => {
      const data = await dataUrl(fetch, url).catch(() => null);

      if (data === null) return Option.none<typeof Cached.Type>();
      const entry = { url, data };
      await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => undefined);
      await writeFile(path(id), JSON.stringify(entry), { mode: 0o600 }).catch(() => undefined);

      return Option.some(entry);
    });

  return {
    /** The data URL for `url`, or null until it loads. */
    get: (id: string, url: string | null) => {
      const entry = cached.get(id);

      return url !== null && entry?.url === url ? entry.data : null;
    },
    missing: (id: string, url: string | null) => url !== null && tried.get(id) !== url,
    load: (id: string, url: string | null) =>
      Effect.gen(function* () {
        if (url === null) return;
        tried.set(id, url);
        const disk = yield* fromDisk(id, url);
        const entry = Option.isSome(disk) ? disk : yield* fromNetwork(id, url);

        if (Option.isSome(entry)) cached.set(id, entry.value);
      }),
    forget: (id: string) =>
      Effect.promise(() => rm(path(id), { force: true }).catch(() => undefined)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            cached.delete(id);
            tried.delete(id);
          })
        )
      ),
  };
};
