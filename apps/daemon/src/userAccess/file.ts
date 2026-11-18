/**
 * `~/.polaris/user-access.json` (ADR 0114): the digests of the user keys this Host enrolled,
 * owner-only. A version 1 file is 0.9.0's single enrolment, which nothing has checked since 0.9.2.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostId } from "@polaris/protocol";
import { Option, Schema } from "effect";
import { paths } from "../paths.ts";

const Enrolment = Schema.Struct({
  digest: Schema.String,
  label: Schema.String,
  enrolledAt: Schema.String,
});

export type Enrolment = typeof Enrolment.Type;

const EnrolmentFile = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Literal(2), keys: Schema.Array(Enrolment) })
);

const OlderFile = Schema.fromJsonString(Schema.Struct({ version: Schema.Literal(1) }));

const decodeFile = Schema.decodeUnknownOption(EnrolmentFile);

const decodeOlder = Schema.decodeUnknownOption(OlderFile);

const encodeFile = Schema.encodeSync(EnrolmentFile);

export const userAccessFile = (root: string = paths().root) => join(root, "user-access.json");

/** A key's digest, bound to this Host: the same key gives another digest on another Host. */
export const digestOf = (hostId: HostId, key: string) =>
  createHash("sha256")
    .update(JSON.stringify(["polaris-user-access-v1", hostId, key]))
    .digest("hex");

export interface Registry {
  /** A version 2 file exists: the Host enrolled its first Desktop App, even if none is left. */
  readonly initialised: boolean;
  readonly keys: ReadonlyArray<Enrolment>;
}

const FRESH: Registry = { initialised: false, keys: [] };

/** None when the file is unreadable or corrupt: then nothing is enrolled over it. */
export const readEnrolments = (file: string): Option.Option<Registry> => {
  let text: string;

  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";

    return missing ? Option.some(FRESH) : Option.none();
  }

  if (Option.isSome(decodeOlder(text))) return Option.some(FRESH);

  return Option.map(decodeFile(text), (decoded) => ({ initialised: true, keys: decoded.keys }));
};

/** Whether the write landed; a partial file never replaces the last good one. */
export const writeEnrolments = (file: string, keys: ReadonlyArray<Enrolment>): boolean => {
  const partial = `${file}.${randomBytes(8).toString("hex")}.part`;

  try {
    writeFileSync(partial, encodeFile({ version: 2, keys }), { mode: 0o600, flag: "wx" });
    chmodSync(partial, 0o600);
    renameSync(partial, file);

    return true;
  } catch {
    return false;
  }
};
