import { constants } from "node:fs";
import { access, mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { Context, Schema } from "effect";
import { LanguageCounter, LanguagePath, type WorkspaceId } from "@polaris/protocol";
import { readJson } from "../discovery/files.ts";
import { failure } from "../install/validation.ts";

const Record = Schema.Struct({
  revision: LanguageCounter,
  interpreter: Schema.NullOr(LanguagePath),
});

/** Validate presence only; preserving the entry path keeps virtual environment identity. */
export async function interpreterEntry(path: string) {
  if (!isAbsolute(path) || path.includes("\0"))
    throw failure("invalid-input", "Expected an absolute interpreter path");
  const entry = resolve(path);
  const target = await realpath(entry);

  if (!(await stat(target)).isFile()) throw failure("invalid-input", "Interpreter is not a file");
  await access(entry, constants.X_OK);

  return { path: entry, target };
}

/** One bounded, atomic Host repository; selection never executes the selected file. */
export function createPythonEnvironment(directory: string) {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const file = (workspaceId: WorkspaceId) =>
    join(directory, createHash("sha256").update(workspaceId).digest("hex") + ".json");

  const read = async (workspaceId: WorkspaceId) => {
    try {
      return Schema.decodeUnknownSync(Record)(await readJson(file(workspaceId)));
    } catch (cause) {
      if (Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(cause))
        return Record.make({ revision: 0, interpreter: null });
      throw cause;
    }
  };

  const select = (
    workspaceId: WorkspaceId,
    interpreter: string | null,
    expectedRevision: number,
    requireCurrent: () => Promise<void>
  ) => {
    if (pending >= 32)
      return Promise.reject(failure("queue-full", "Interpreter selection queue is full", true));
    pending++;

    const task = tail
      .then(async () => {
        await requireCurrent();
        const current = await read(workspaceId);

        if (current.revision !== expectedRevision)
          throw failure("conflict", "Python interpreter selection changed", true);
        const selected = interpreter === null ? null : (await interpreterEntry(interpreter)).path;
        const record = Record.make({ revision: expectedRevision + 1, interpreter: selected });
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const destination = file(workspaceId);
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

export class PythonEnvironment extends Context.Service<
  PythonEnvironment,
  ReturnType<typeof createPythonEnvironment>
>()("polaris/languages/PythonEnvironment") {}
