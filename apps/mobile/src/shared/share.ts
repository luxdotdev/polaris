/**
 * Sharing a session from the phone (DESIGN.md "Shared Sessions", SS3): look the person up on
 * the sharing Account's server, make the Invite there naming this Host, then record the Share on
 * the Host with the person's id pinned (`shares.create`).
 */
import type { AccountRecord, CreatedInvite, NewInvite, Person } from "@polaris/client/accounts";
import {
  type HarnessKind,
  PersonId,
  InviteId,
  NotFound,
  SessionId,
  ShareRefused,
  type ShareRole,
  ShareTarget,
  Unsupported,
} from "@polaris/protocol";
import { Match, Redacted } from "effect";
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

/** Each call resolves with its value, or rejects with the copy to show. */
export interface ShareCalls {
  readonly person: (accountId: string, login: string) => Promise<Person>;
  readonly invite: (accountId: string, invite: NewInvite) => Promise<CreatedInvite>;
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

const refusal = (reason: ShareRefused["reason"], host: string) =>
  Match.value(reason).pipe(
    Match.when("worker", () => "A worker's session is shared through its constellation."),
    Match.when("issuer-unreachable", () => `${host} couldn't reach your Polaris account's server.`),
    Match.when("invite", () => `${host} couldn't check the invite. Try sharing again.`),
    Match.orElse(() => "The share couldn't be made. Try sharing again.")
  );

/** Any other failure, such as a reply this app can't read: never shown raw. */
export const shareNotTaken = (host: string) =>
  `${host} didn't take the share from this phone. Share it from the desktop app for now.`;

/**
 * What the sheet says when the Host doesn't record the Share (`shares.create`): product copy for
 * each refusal, and never a raw transport or decode error.
 */
export const shareFailure = (
  error: ShareRefused | NotFound | Unsupported | Error,
  host: string
) => {
  if (error instanceof ShareRefused) return refusal(error.reason, host);

  if (error instanceof NotFound) return `This session isn't on ${host} anymore.`;

  if (error instanceof Unsupported) return `${host} needs a newer Polaris to share sessions.`;

  return shareNotTaken(host);
};

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

  return person;
};

export const firstName = (person: Person) =>
  (person.name ?? person.login).split(/\s+/)[0] ?? person.login;

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
