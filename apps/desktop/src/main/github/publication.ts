import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Option, Schema } from "effect";
import type { PublishedDescriptionView } from "../../shared/github.ts";
import { GitHubRequestError } from "./errors.ts";

const Record = Schema.Struct({ hash: Schema.String, head: Schema.String, at: Schema.String });

const fileError = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }));

const Records = Schema.fromJsonString(Schema.Record(Schema.String, Record));

export const descriptionHash = (body: string) => createHash("sha256").update(body).digest("hex");

export const publications = (path: string) => {
  let saved: Readonly<Record<string, PublishedDescriptionView>> | null = null;

  const load = Effect.gen(function* () {
    if (saved !== null) return saved;

    const text = yield* Effect.tryPromise({
      try: () =>
        readFile(path, "utf8").catch((cause: unknown) => {
          if (Option.exists(fileError(cause), (error) => error.code === "ENOENT")) return "{}";

          throw cause;
        }),
      catch: () =>
        new GitHubRequestError({ message: "Could not read published descriptions.", status: 0 }),
    });

    const data = yield* Schema.decodeUnknownEffect(Records)(text).pipe(
      Effect.mapError(
        () =>
          new GitHubRequestError({
            message: "Could not read published descriptions.",
            status: 0,
          })
      )
    );

    saved = data;

    return data;
  });

  const get = (key: string, body: string) =>
    Effect.map(load, (all) => {
      const previous = all[key];

      return previous === undefined
        ? null
        : { ...previous, matches: previous.hash === descriptionHash(body) };
    });

  const set = (key: string, record: PublishedDescriptionView) =>
    Effect.gen(function* () {
      const all = { ...(yield* load), [key]: record };

      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(path), { recursive: true });
          const temporary = `${path}.${process.pid}.tmp`;
          await writeFile(temporary, Schema.encodeSync(Records)(all));
          await rename(temporary, path);
        },
        catch: () =>
          new GitHubRequestError({
            message: "Could not save the published description.",
            status: 0,
          }),
      });
      saved = all;
    });

  return { get, set };
};
