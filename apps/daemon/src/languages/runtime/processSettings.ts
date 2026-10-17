import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import {
  LanguageHostProcessBudget,
  LanguageProcessLimit,
  LanguageCounter,
  type HostId,
} from "@polaris/protocol";
import { readJson } from "../discovery/files.ts";
import { failure } from "../transport/framing.ts";
import {
  deriveProcessLimit,
  hostProcessResources,
  SERVER_ALLOWANCE_BYTES,
  type HostProcessResources,
} from "./process-capacity.ts";

const Record = Schema.Struct({
  revision: LanguageCounter,
  maxProcesses: Schema.NullOr(LanguageProcessLimit),
});

/** One authoritative Host setting; Client-local or Workspace preferences never change capacity. */
export async function createProcessSettings(
  hostId: HostId,
  directory: string,
  resources: HostProcessResources = hostProcessResources()
) {
  const path = join(directory, "process-budget.json");
  const automaticLimit = deriveProcessLimit(resources);
  let current: typeof Record.Type;

  try {
    current = Schema.decodeUnknownSync(Record)(await readJson(path));
  } catch (cause) {
    if (!Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(cause)) throw cause;
    current = Record.make({ revision: 0, maxProcesses: null });
  }

  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const snapshot = () =>
    LanguageHostProcessBudget.make({
      hostId,
      ...current,
      ...resources,
      automaticLimit,
      effectiveLimit: current.maxProcesses ?? automaticLimit,
      serverAllowanceBytes: SERVER_ALLOWANCE_BYTES,
    });

  function set(
    expectedRevision: number,
    maxProcesses: number | null,
    requireCurrent: () => Promise<void>,
    apply: (limit: number) => Promise<void> = async () => {}
  ) {
    const next = Record.make({ revision: expectedRevision + 1, maxProcesses });

    if (pending >= 32)
      return Promise.reject(failure("queue-full", "Host language settings queue is full"));
    pending++;

    const task = tail
      .then(async () => {
        await requireCurrent();

        if (current.revision !== expectedRevision)
          throw failure("conflict", "Host language process settings changed");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = path + "." + randomUUID() + ".tmp";
        const handle = await open(temporary, "wx", 0o600);

        try {
          try {
            await handle.writeFile(JSON.stringify(next));
            await handle.sync();
          } finally {
            await handle.close();
          }

          await requireCurrent();
          await rename(temporary, path);
          current = next;
          await apply(current.maxProcesses ?? automaticLimit);

          // Windows opens no directory for fsync (EPERM); NTFS journals the rename itself.
          if (process.platform !== "win32") {
            const parent = await open(directory, "r");

            try {
              await parent.sync();
            } finally {
              await parent.close();
            }
          }

          return snapshot();
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      })
      .finally(() => {
        pending--;
      });

    tail = task.catch(() => undefined);

    return task;
  }

  return { snapshot, set };
}
