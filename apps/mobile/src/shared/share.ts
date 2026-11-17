/**
 * Sharing a session from the phone (DESIGN.md "Shared Sessions", SS3): look the person up on
 * the sharing Account's server, make the Invite there naming this Host, then record the Share on
 * the Host with the person's id pinned (`shares.create`). A refused Share withdraws its Invite.
 */
import type { AccountRecord, CreatedInvite, NewInvite, Person } from "@polaris/client/accounts";
import {
  type HarnessKind,
  PersonId,
  InviteId,
  NotFound,
  NotGranted,
  SessionId,
  ShareRefused,
  Unsupported,
  type ShareRole,
  ShareTarget,
} from "@polaris/protocol";
import { Match, Redacted, Schema } from "effect";
import { loginName } from "./login.ts";

/** The owner's Host as the relay reaches it: what an Invite tells the Teammate's device. */
export interface ShareHost {
  readonly name: string;
  readonly relayAddress: string;
  readonly noiseKey: string;
  /** The relay the Host is linked through, so the Teammate's device dials the same one. */
  readonly relayUrl: string;
}

export interface ShareRequest {
  readonly account: AccountRecord;
  readonly host: ShareHost;
  readonly sessionId: string;
  readonly title: string;
  readonly login: string;
  readonly role: ShareRole;
}

/** Each call resolves with its value, or rejects with the copy to show; `create` with the Host's error. */
export interface ShareCalls {
  readonly person: (accountId: string, login: string) => Promise<Person>;
  readonly invite: (accountId: string, invite: NewInvite) => Promise<CreatedInvite>;
  /** Ends an Invite the Host didn't record a Share for, so nobody can accept it. */
  readonly withdraw: (accountId: string, invite: CreatedInvite) => Promise<void>;
  readonly create: (share: {
    readonly target: ShareTarget;
    readonly personId: PersonId;
    readonly inviteeLogin: string;
    readonly role: ShareRole;
    readonly expiresAt: null;
    readonly issuer: string;
    readonly inviteId: InviteId;
    readonly hostCapability: Redacted.Redacted<string>;
  }) => Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The default lifetime the Host gives a Share made with no expiry (`SHARE_DEFAULT_LIFETIME_MS`). */
const SHARE_DAYS = 7;

/** "octocat" from "@octocat" or " octocat ". */
export const loginOf = (typed: string) => typed.trim().replace(/^@/, "");

export const shareSession = async (
  request: ShareRequest,
  calls: ShareCalls,
  now = Date.now()
): Promise<Person> => {
  const login = loginOf(request.login);
  const person = await calls.person(request.account.id, login);

  const created = await calls.invite(request.account.id, {
    inviteeLogin: person.login,
    share: { id: request.sessionId, title: request.title, kind: "session" },
    host: request.host,
    role: request.role,
    expiresAt: new Date(now + SHARE_DAYS * DAY_MS).toISOString(),
  });

  try {
    await calls.create({
      target: ShareTarget.cases.Session.make({ sessionId: SessionId.make(request.sessionId) }),
      personId: PersonId.make(person.personId),
      inviteeLogin: person.login,
      role: request.role,
      expiresAt: null,
      issuer: request.account.server,
      inviteId: InviteId.make(created.inviteId),
      hostCapability: Redacted.make(created.hostCapability),
    });
  } catch (error) {
    await calls.withdraw(request.account.id, created).catch(() => undefined);

    const refusal = isHostRefusal(error) ? error : null;

    throw new Error(shareRefusal(refusal, request.host.name), { cause: error });
  }

  return person;
};

/** What the Host answers a `shares.create` it refuses. */
const HostRefusal = Schema.Union([NotGranted, ShareRefused, NotFound, Unsupported]);

export type HostRefusal = typeof HostRefusal.Type;

const isHostRefusal = Schema.is(HostRefusal);

const REFUSED = {
  expiry: () => "A share lasts at most 30 days.",
  worker: () => "A worker's session is shared through its constellation.",
  invite: (host: string) =>
    `${host} couldn't confirm the invite with your Polaris account. Try again.`,
  "issuer-unreachable": (host: string) =>
    `${host} couldn't reach your Polaris account's server. Try again.`,
  ended: () => "This share has ended.",
} satisfies Record<ShareRefused["reason"], (host: string) => string>;

/** What the sheet says when the Host refuses `shares.create` (null: it never answered). */
export const shareRefusal = (refusal: HostRefusal | null, host: string): string => {
  const newer = () => `${host} needs a newer Polaris to share from your phone.`;

  if (refusal === null) return `${host} didn't share the session. Try again.`;

  return Match.value(refusal).pipe(
    Match.tagsExhaustive({
      ShareRefused: ({ reason }) => REFUSED[reason](host),
      NotGranted: newer,
      Unsupported: newer,
      NotFound: () => `This session is no longer on ${host}.`,
    })
  );
};

/** The sheet's line once the Invite is out: by GitHub login, as the sheet names people. */
export const invitedLine = (person: Person, role: ShareRole) =>
  `Invited @${person.login} as a ${role}.`;

/** What the sheet says sharing allows, plainly (DESIGN.md "Share"). */
export const shareConsequences = (
  name: string,
  role: ShareRole,
  harness: HarnessKind
): ReadonlyArray<string> => [
  `${name} will see everything in this session, including command output.`,
  role === "contributor"
    ? `${name} can send Turns and answer approvals. ${name === "They" ? "Their" : `${name}'s`} Turns run on your ${loginName(harness)} login and count against your plan.`
    : `${name} can comment, but not send Turns or answer approvals.`,
];
