import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { Context, Predicate, Schema } from "effect";
import { LanguageCounter, LanguageSqlDialect, type LanguageCheckout } from "@polaris/protocol";
import { readJson } from "../discovery/files.ts";
import { checkoutKey } from "../trust/index.ts";
import { failure } from "../install/validation.ts";

const Record = Schema.Struct({
  revision: LanguageCounter,
  workspace: Schema.NullOr(LanguageSqlDialect),
  files: Schema.Record(Schema.String, LanguageSqlDialect).check(Schema.isMaxProperties(1024)),
});

export function sqlScope(checkout: LanguageCheckout) {
  return Predicate.isTagged(checkout, "ReviewCheckout")
    ? checkoutKey(checkout)
    : checkout.workspaceId;
}

export function createSqlSelection(directory: string) {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const file = (checkout: LanguageCheckout) =>
    join(directory, createHash("sha256").update(sqlScope(checkout)).digest("hex") + ".json");

  const read = async (checkout: LanguageCheckout) => {
    try {
      return Schema.decodeUnknownSync(Record)(await readJson(file(checkout)));
    } catch (cause) {
      if (Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(cause))
        return Record.make({ revision: 0, workspace: null, files: {} });
      throw cause;
    }
  };

  const select = (
    checkout: LanguageCheckout,
    root: string,
    path: string,
    scope: "file" | "workspace",
    dialect: LanguageSqlDialect | null,
    expectedRevision: number,
    requireCurrent: () => Promise<void>
  ) => {
    if (pending >= 32)
      return Promise.reject(failure("queue-full", "SQL dialect selection queue is full", true));
    pending++;

    const task = tail
      .then(async () => {
        await requireCurrent();
        const current = await read(checkout);

        if (current.revision !== expectedRevision)
          throw failure("conflict", "SQL dialect selection changed", true);
        const files = { ...current.files };
        const key = relative(root, path);

        if (scope === "file") {
          if (dialect === null) delete files[key];
          else files[key] = dialect;
        }

        const record = Record.make({
          revision: expectedRevision + 1,
          files,
          workspace: scope === "workspace" ? dialect : current.workspace,
        });

        await mkdir(directory, { recursive: true, mode: 0o700 });
        const destination = file(checkout);
        const temporary = destination + "." + randomUUID() + ".tmp";
        const handle = await open(temporary, "wx", 0o600);

        try {
          try {
            await handle.writeFile(JSON.stringify(record));
            await handle.sync();
          } finally {
            await handle.close();
          }

          await requireCurrent();
          await rename(temporary, destination);
          const parent = await open(directory, "r");

          try {
            await parent.sync();
          } finally {
            await parent.close();
          }
        } finally {
          await unlink(temporary).catch(() => undefined);
        }

        return record;
      })
      .finally(() => {
        pending--;
      });

    tail = task.catch(() => undefined);

    return task;
  };

  return { read, select };
}

export class SqlSelection extends Context.Service<
  SqlSelection,
  ReturnType<typeof createSqlSelection>
>()("polaris/languages/SqlSelection") {}
