import { and, eq, gt, ne, or, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import {
  type HostRef,
  InvalidInvite,
  InviteClosed,
  InviteNotFound,
  type Role,
  type ShareRef,
} from "../api/definition.ts";
import { invite, shareDevice, user } from "../db/schema.ts";
import { findByLogin, findPerson, toPerson } from "../people/index.ts";
import { Accounts, ShareChanges, store } from "../server/services.ts";

/** The longest an Invite may run before it lapses (DESIGN.md, Shared Sessions). */
export const MAX_INVITE_DAYS = 30;

const CLOCK_SLACK_MS = 5 * 60 * 1000;

const decodeShareKind = Schema.decodeUnknownSync(Schema.Literals(["session", "constellation"]));

const decodeRole = Schema.decodeUnknownSync(Schema.Literals(["contributor", "commenter"]));

export type InviteRow = typeof invite.$inferSelect;

const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export const hashCapability = (capability: string) =>
  new Bun.CryptoHasher("sha256").update(capability).digest("hex");

export const shareOf = (row: InviteRow): typeof ShareRef.Type => ({
  id: row.shareId,
  title: row.shareTitle,
  kind: decodeShareKind(row.shareKind),
});

const hostOf = (row: InviteRow): typeof HostRef.Type => ({
  name: row.hostName,
  relayAddress: row.hostRelayAddress,
  noiseKey: row.hostNoiseKey,
});

export const createInvite = Effect.fn("createInvite")(function* (
  ownerId: string,
  input: {
    readonly inviteeLogin: string;
    readonly share: typeof ShareRef.Type;
    readonly host: typeof HostRef.Type;
    readonly role: typeof Role.Type;
    readonly expiresAt: string;
  }
) {
  const { db } = yield* Accounts;
  const invitee = yield* findByLogin(ownerId, input.inviteeLogin);

  if (invitee.id === ownerId)
    return yield* new InvalidInvite({ message: "You can't invite yourself." });
  const expiresAt = new Date(input.expiresAt);
  const now = Date.now();
  const latest = now + MAX_INVITE_DAYS * 24 * 60 * 60 * 1000 + CLOCK_SLACK_MS;

  if (
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.getTime() <= now ||
    expiresAt.getTime() > latest
  ) {
    return yield* new InvalidInvite({
      message: `expiresAt must be an ISO time in the next ${MAX_INVITE_DAYS} days.`,
    });
  }

  const inviteId = crypto.randomUUID();
  const hostCapability = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  yield* store(() =>
    db.insert(invite).values({
      id: inviteId,
      ownerId,
      inviteeId: invitee.id,
      shareId: input.share.id,
      shareTitle: input.share.title,
      shareKind: input.share.kind,
      hostName: input.host.name,
      hostRelayAddress: input.host.relayAddress,
      hostNoiseKey: input.host.noiseKey,
      role: input.role,
      expiresAt,
      status: "pending",
      capabilityHash: hashCapability(hostCapability),
    })
  );

  return { inviteId, hostCapability };
});

export const pendingInvites = Effect.fn("pendingInvites")(function* (personId: string) {
  const { db } = yield* Accounts;

  const rows = yield* store(() =>
    db
      .select({ invite, owner: user })
      .from(invite)
      .innerJoin(user, eq(user.id, invite.ownerId))
      .where(
        and(
          eq(invite.inviteeId, personId),
          eq(invite.status, "pending"),
          gt(invite.expiresAt, new Date())
        )
      )
      .orderBy(invite.createdAt)
  );

  return rows.map(({ invite: row, owner }) => ({
    inviteId: row.id,
    owner: toPerson(owner),
    share: shareOf(row),
    host: { name: row.hostName },
    role: decodeRole(row.role),
    expiresAt: row.expiresAt.toISOString(),
  }));
});

/** The teammate's own Invite, open to answer: pending and unexpired, or already accepted. */
const openInviteFor = Effect.fn("openInviteFor")(function* (personId: string, inviteId: string) {
  const { db } = yield* Accounts;

  const rows = yield* store(() =>
    db
      .select()
      .from(invite)
      .where(and(eq(invite.id, inviteId), eq(invite.inviteeId, personId)))
      .limit(1)
  );

  const row = rows[0];

  if (row === undefined) return yield* new InviteNotFound({ inviteId });
  const lapsed = row.status === "pending" && row.expiresAt.getTime() <= Date.now();

  if (lapsed) return yield* new InviteClosed({ inviteId, status: "lapsed" });

  if (row.status !== "pending" && row.status !== "accepted") {
    return yield* new InviteClosed({ inviteId, status: row.status });
  }

  return row;
});

/** Matches the invitee's Invite while it can still be answered: pending and unexpired, or accepted. */
const answerable = (personId: string, inviteId: string) =>
  and(
    eq(invite.id, inviteId),
    eq(invite.inviteeId, personId),
    or(
      eq(invite.status, "accepted"),
      and(eq(invite.status, "pending"), gt(invite.expiresAt, sql`now()`))
    )
  );

/** Why an answer changed nothing: a missing or closed Invite, read after the fact. */
const notAnswerable = Effect.fn(function* (personId: string, inviteId: string) {
  const row = yield* openInviteFor(personId, inviteId);

  return yield* new InviteClosed({ inviteId, status: row.status });
});

class NotAnswerable extends Error {}

/** Accepts an Invite from one device; a second device of the same person accepts it again. */
export const acceptInvite = Effect.fn("acceptInvite")(function* (
  personId: string,
  inviteId: string,
  device: { readonly relayAddress: string; readonly noiseKey: string }
) {
  const { db } = yield* Accounts;
  const changes = yield* ShareChanges;

  // One conditional update, so a revoke or decline that lands first is never overwritten.
  const row = yield* store(() =>
    db.transaction(async (tx) => {
      const [updated] = await tx
        .update(invite)
        .set({
          status: "accepted",
          version: sql`${invite.version} + 1`,
          answeredAt: sql`coalesce(${invite.answeredAt}, now())`,
        })
        .where(answerable(personId, inviteId))
        .returning();

      if (updated === undefined) throw new NotAnswerable();

      await tx
        .insert(shareDevice)
        .values({ inviteId, ...device })
        .onConflictDoUpdate({
          target: [shareDevice.inviteId, shareDevice.noiseKey],
          set: { relayAddress: device.relayAddress },
        });

      return updated;
    })
  ).pipe(
    Effect.catchTag("StoreError", (error) =>
      error.cause instanceof NotAnswerable ? notAnswerable(personId, inviteId) : Effect.fail(error)
    )
  );

  yield* changes.changed(inviteId);
  const owner = yield* findPerson(row.ownerId);

  return {
    host: hostOf(row),
    share: shareOf(row),
    role: decodeRole(row.role),
    owner: toPerson(owner),
  };
});

/** Declines a pending Invite, or leaves an accepted Share; the Host's device list empties. */
export const declineInvite = Effect.fn("declineInvite")(function* (
  personId: string,
  inviteId: string
) {
  const { db } = yield* Accounts;
  const changes = yield* ShareChanges;

  const updated = yield* store(() =>
    db
      .update(invite)
      .set({ status: "declined", version: sql`${invite.version} + 1`, answeredAt: sql`now()` })
      .where(answerable(personId, inviteId))
      .returning({ id: invite.id })
  );

  if (updated.length === 0) return yield* notAnswerable(personId, inviteId);

  yield* changes.changed(inviteId);
});

/** The live Invite a Host's capability names, if any. */
export const inviteForCapability = Effect.fn("inviteForCapability")(function* (capability: string) {
  const { db } = yield* Accounts;

  const rows = yield* store(() =>
    db
      .select()
      .from(invite)
      .where(
        and(eq(invite.capabilityHash, hashCapability(capability)), ne(invite.status, "revoked"))
      )
      .limit(1)
  );

  return rows[0];
});

export const revokeShare = Effect.fn("revokeShare")(function* (inviteId: string) {
  const { db } = yield* Accounts;
  const changes = yield* ShareChanges;
  yield* store(() =>
    db
      .update(invite)
      .set({ status: "revoked", version: sql`${invite.version} + 1` })
      .where(eq(invite.id, inviteId))
  );
  yield* changes.changed(inviteId);
});

/** The Share's version and its teammate's accepted devices (none unless accepted). */
export const shareDevices = Effect.fn("shareDevices")(function* (inviteId: string) {
  const { db } = yield* Accounts;

  const rows = yield* store(() =>
    db
      .select({ version: invite.version, status: invite.status, inviteeId: invite.inviteeId })
      .from(invite)
      .where(eq(invite.id, inviteId))
      .limit(1)
  );

  const row = rows[0];

  if (row === undefined) return { version: 0, inviteeId: undefined, devices: [] };

  const devices =
    row.status === "accepted"
      ? yield* store(() =>
          db
            .select({ relayAddress: shareDevice.relayAddress, noiseKey: shareDevice.noiseKey })
            .from(shareDevice)
            .where(eq(shareDevice.inviteId, inviteId))
            .orderBy(shareDevice.createdAt)
        )
      : [];

  return { version: row.version, inviteeId: row.inviteeId, devices };
});
