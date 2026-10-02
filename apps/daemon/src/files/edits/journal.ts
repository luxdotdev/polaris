import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { FileVersion, LanguageOperationOutcome } from "@polaris/protocol";
import { Schema } from "effect";

const Move = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  version: FileVersion,
  step: Schema.Int,
  state: Schema.Literals(["pending", "forward", "applied", "backward", "restored"]),
});

export const Journal = Schema.Struct({
  format: Schema.Literal(1),
  fingerprint: Schema.String,
  root: Schema.String,
  outcome: LanguageOperationOutcome,
  moves: Schema.Array(Move),
});

export type Journal = typeof Journal.Type;

export type Move = typeof Move.Type;

export type Owner = LanguageOperationOutcome["owner"];

export const identity = (owner: Owner, operationId: string) =>
  createHash("sha256")
    .update(JSON.stringify([owner, operationId]))
    .digest("hex");

export const fingerprint = <A>(value: A) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const syncDirectory = async (path: string) => {
  const handle = await open(path, "r");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const loadJournal = async (directory: string): Promise<Journal | null> => {
  try {
    return Schema.decodeUnknownSync(Journal)(
      JSON.parse(await readFile(join(directory, "receipt.json"), "utf8"))
    );
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
    throw cause;
  }
};

export const persistJournal = async (directory: string, journal: Journal) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const next = {
    ...journal,
    outcome: {
      ...journal.outcome,
      receiptDurable: true,
      receiptRevision: journal.outcome.receiptRevision + 1,
    },
  };

  const encoded = JSON.stringify(Schema.decodeUnknownSync(Journal)(next));
  const temp = join(directory, `.receipt-${randomUUID()}`);

  try {
    const handle = await open(temp, "wx", 0o600);

    try {
      await handle.writeFile(encoded);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temp, join(directory, "receipt.json"));
    await syncDirectory(directory);
    await syncDirectory(join(directory, ".."));

    return next;
  } finally {
    await unlink(temp).catch(() => {});
  }
};
