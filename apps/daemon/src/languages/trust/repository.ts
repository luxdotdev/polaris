import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { LanguageTrustScope, LanguageError } from "@polaris/protocol";
import { Schema } from "effect";
import { TrustRecord, trustScopeKey, type TrustRepository } from "./index.ts";
import { readJson } from "../discovery/files.ts";

/** One repository instance per Daemon, in its private Host state directory. No implicit home. */
export function createFileTrustRepository(directory: string): TrustRepository {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const file = (scope: typeof LanguageTrustScope.Type) =>
    join(directory, `${createHash("sha256").update(trustScopeKey(scope)).digest("hex")}.json`);

  async function read(scope: typeof LanguageTrustScope.Type) {
    try {
      return Schema.decodeUnknownSync(TrustRecord)(await readJson(file(scope)));
    } catch (error) {
      if (Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(error)) return null;
      throw error;
    }
  }

  async function write(record: TrustRecord, expectedRevision: number) {
    const current = await read(record.trust.scope);

    if ((current?.trust.revision ?? 0) !== expectedRevision) return false;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = file(record.trust.scope);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);

    try {
      try {
        await handle.writeFile(JSON.stringify(record));
        await handle.sync();
      } finally {
        await handle.close();
      }

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

    return true;
  }

  function compareAndSet(record: TrustRecord, expectedRevision: number) {
    if (pending >= 32)
      return Promise.reject(
        new LanguageError({
          reason: "queue-full",
          message: "Trust write queue is full",
          retryable: true,
        })
      );
    pending++;

    const operation = tail
      .then(() => write(Schema.decodeUnknownSync(TrustRecord)(record), expectedRevision))
      .finally(() => {
        pending--;
      });

    tail = operation.catch(() => undefined);

    return operation;
  }

  return { read, compareAndSet };
}
