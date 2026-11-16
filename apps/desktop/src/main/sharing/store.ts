/**
 * What was shared with this user, kept across launches in `<userData>/sharing/shared.json`
 * (nothing secret): each accepted Invite's owner, their Host's relay keys, the session and role.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ShareRole } from "@polaris/protocol";
import { Effect, Option, Schema } from "effect";

export const SharedEntry = Schema.Struct({
  /** The Polaris account the Invite came through. */
  accountId: Schema.String,
  inviteId: Schema.String,
  owner: Schema.Struct({
    login: Schema.String,
    name: Schema.NullOr(Schema.String),
    avatarUrl: Schema.NullOr(Schema.String),
  }),
  host: Schema.Struct({
    name: Schema.String,
    relayAddress: Schema.String,
    noiseKey: Schema.String,
    /** The relay the owner's Host is on; Polaris Cloud's when the Invite named none. */
    relayUrl: Schema.optionalKey(Schema.String),
  }),
  sessionId: Schema.String,
  title: Schema.String,
  role: ShareRole,
  acceptedAt: Schema.Number,
});

export type SharedEntry = typeof SharedEntry.Type;

const SharedFile = Schema.Struct({ v: Schema.Literal(1), shared: Schema.Array(SharedEntry) });

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(SharedFile));

/** The Host key a Teammate's connection to an owner's Host goes by. */
export const sharedHostKey = (relayAddress: string) => `shared-${relayAddress}`;

export interface SharedStore {
  readonly read: Effect.Effect<ReadonlyArray<SharedEntry>>;
  readonly write: (shared: ReadonlyArray<SharedEntry>) => Effect.Effect<void>;
}

export const fileSharedStore = (dir: string): SharedStore => {
  const path = join(dir, "shared.json");

  return {
    read: Effect.promise(() => readFile(path, "utf8").catch(() => "")).pipe(
      Effect.map((text) =>
        Option.match(decode(text), { onNone: () => [], onSome: (f) => f.shared })
      )
    ),
    write: (shared) =>
      Effect.promise(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(`${path}.part`, `${JSON.stringify({ v: 1, shared }, null, 2)}\n`, {
          mode: 0o600,
        });
        await rename(`${path}.part`, path);
      }).pipe(Effect.ignore),
  };
};

export const memorySharedStore = (initial: ReadonlyArray<SharedEntry> = []): SharedStore => {
  let shared = initial;

  return {
    read: Effect.sync(() => shared),
    write: (next) =>
      Effect.sync(() => {
        shared = next;
      }),
  };
};
