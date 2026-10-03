import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  LanguageResourceIdentity,
  LanguageTreeManifest,
  LanguageTreeOperationOutcome,
} from "@polaris/protocol";
import { Schema } from "effect";

const Move = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  tree: LanguageTreeManifest,
  parents: Schema.Array(Schema.Struct({ path: Schema.String, identity: LanguageResourceIdentity })),
  step: Schema.Int,
  state: Schema.Literals(["pending", "forward", "applied", "backward", "restored"]),
});

export const Journal = Schema.Struct({
  format: Schema.Literal(2),
  fingerprint: Schema.String,
  root: Schema.String,
  rootIdentity: LanguageResourceIdentity,
  outcome: LanguageTreeOperationOutcome,
  moves: Schema.Array(Move),
});

export type Journal = typeof Journal.Type;

export type Move = typeof Move.Type;

export type Owner = LanguageTreeOperationOutcome["owner"];

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
      JSON.parse(await readReceipt(join(directory, "receipt.json")))
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

  if (Buffer.byteLength(encoded, "utf8") > 4194304)
    throw new Error("Tree journal exceeds durable receipt budget");
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

const readReceipt = async (path: string) => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const stat = await handle.stat();

    if (!stat.isFile() || stat.size > 4194304)
      throw new Error("Tree receipt exceeds raw read budget");
    const bytes = new Uint8Array(stat.size + 1);
    let size = 0;

    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, size);

      if (!read.bytesRead) break;
      size += read.bytesRead;
    }

    if (size !== stat.size || (await handle.stat()).size !== size)
      throw new Error("Tree receipt changed during read");

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally {
    await handle.close();
  }
};
