import { describe, expect, test } from "bun:test";
import type { AccountRecord, PendingInvite } from "@polaris/client/accounts";
import { AccountsError } from "@polaris/client/accounts";
import { Actor, PersonId, SharePresenceEntry, ShareId, LinkedDeviceId } from "@polaris/protocol";
import type { HostView } from "../../shared/api.ts";
import { lookupFailure } from "./owner.ts";
import { type SharedEntry, sharedHostKey } from "./store.ts";
import { withMeView } from "./teammate.ts";
import { presenceViews } from "./views.ts";

const noAvatar = () => null;

const account = (id: string, login: string, signedOutAt: number | null = null): AccountRecord => ({
  id,
  server: "https://auth.polaris.lux.dev",
  personId: `p-${id}`,
  login,
  name: null,
  avatarUrl: null,
  commitEmail: `${login}@work.example`,
  commitEmails: [`${login}@work.example`],
  signedInAt: 1,
  signedOutAt,
});

const invite = (inviteId: string, title: string): PendingInvite => ({
  inviteId,
  owner: { personId: "p-lucas", login: "lucas", name: "Lucas", avatarUrl: null },
  share: { id: `s-${inviteId}`, title, kind: "session" },
  host: { name: "Mac Studio" },
  role: "commenter",
  expiresAt: "2026-11-23T00:00:00.000Z",
});

const RELAY = "AAAAAAAAAAAAAAAAAAAAAA";

const entry: SharedEntry = {
  accountId: "a1",
  inviteId: "inv-accepted",
  owner: { login: "lucas", name: "Lucas", avatarUrl: null },
  host: { name: "Mac Studio", relayAddress: RELAY, noiseKey: "k" },
  sessionId: "s-accepted",
  title: "Fix login",
  role: "commenter",
  acceptedAt: 5,
};

const hostView = (state: HostView["status"]["state"], reason: string | null): HostView => ({
  key: sharedHostKey(RELAY),
  label: "Mac Studio",
  colour: null,
  alias: null,
  kind: "relay",
  proofHarness: false,
  shared: true,
  status: {
    state,
    // SAFETY: only `reason` is read; the rest of a failure is irrelevant to these views.
    failure: reason === null ? null : ({ kind: "needs-attention", reason, detail: "" } as never),
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 0,
    latencyMs: null,
    lastSeenAt: null,
  },
});

describe("Shared with you", () => {
  test("an Invite accepted on this device leaves the list; a signed-out Account's Invites don't show", () => {
    const view = withMeView({
      accounts: [account("a1", "maya"), account("a2", "maya-work", 9)],
      invites: new Map([
        ["a1", [invite("inv-accepted", "Fix login"), invite("inv-new", "Docs pass")]],
        ["a2", [invite("inv-other", "Old")]],
      ]),
      shared: [entry],
      hosts: [],
      avatar: noAvatar,
    });

    expect(view.invites.map((i) => [i.title, i.commitEmail])).toEqual([
      ["Docs pass", "maya@work.example"],
    ]);
    expect(view.accounts).toEqual([{ id: "a1", login: "maya" }]);
    expect(view.sessions.map((s) => s.title)).toEqual(["Fix login"]);
  });

  test("an unreachable owner's Host reads offline; a Share that ended doesn't", () => {
    const at = (state: HostView["status"]["state"], reason: string | null) =>
      withMeView({
        accounts: [account("a1", "maya")],
        invites: new Map(),
        shared: [entry],
        hosts: [hostView(state, reason)],
        avatar: noAvatar,
      }).sessions[0];

    expect(at("offline", "unreachable")).toMatchObject({ hostOffline: true, ended: false });
    expect(at("connected", null)).toMatchObject({ hostOffline: false, ended: false });
    expect(at("needs-attention", "share-ended")).toMatchObject({ hostOffline: false, ended: true });
  });
});

describe("share sheet errors", () => {
  test("a login the Account Server doesn't know names the login and the server", () => {
    const error = lookupFailure(
      "alex",
      "https://auth.polaris.lux.dev"
    )(
      new AccountsError({
        reason: "refused",
        message: "not found",
        status: 404,
        serverTag: "PersonNotFound",
      })
    );

    expect([error._tag, error.message]).toEqual([
      "PersonNotFound",
      "@alex hasn't signed in to Polaris on auth.polaris.lux.dev.",
    ]);
  });

  test("a lapsed Polaris account asks to sign in again", () => {
    const error = lookupFailure(
      "alex",
      "http://127.0.0.1:4000"
    )(new AccountsError({ reason: "signed-out", message: "401" }));

    expect(error._tag).toBe("SignedOut");
  });
});

describe("presence", () => {
  test("the owner's devices fold into one entry; each Teammate keeps theirs", () => {
    const since = "2026-11-16T00:00:00.000Z";

    const views = presenceViews(
      [
        new SharePresenceEntry({ actor: Actor.cases.Client.make({}), avatarUrl: null, since }),
        new SharePresenceEntry({
          actor: Actor.cases.LinkedDevice.make({
            deviceId: LinkedDeviceId.make("d1"),
            name: "iPhone",
          }),
          avatarUrl: null,
          since,
        }),
        new SharePresenceEntry({
          actor: Actor.cases.Teammate.make({
            shareId: ShareId.make("sh1"),
            personId: PersonId.make("p-maya"),
            name: "Maya",
          }),
          avatarUrl: null,
          since,
        }),
      ],
      noAvatar,
      { login: "lucas", name: "You", avatar: null }
    );

    expect(views.map((v) => [v.person.name, v.isOwner])).toEqual([
      ["You", true],
      ["Maya", false],
    ]);
  });
});
