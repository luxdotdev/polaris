/**
 * A fake Account Server as a `fetch`, enough of the contract for `Accounts`' own logic: PKCE
 * codes, `/v1/me`, statements, sign-out, the device flow, people, Invites and withdrawing one. The
 * real one is in the slow test.
 */
import { Effect, Option, Schema } from "effect";
import type { Fetch } from "./http.ts";
import { challengeOf } from "./server.ts";
import type { Authorizer } from "./service.ts";

export interface FakePerson {
  readonly personId: string;
  readonly login: string;
}

const Body = Schema.Struct({
  code: Schema.optionalKey(Schema.String),
  code_verifier: Schema.optionalKey(Schema.String),
  device_code: Schema.optionalKey(Schema.String),
  noiseKey: Schema.optionalKey(Schema.String),
});

const decodeBody = Schema.decodeUnknownOption(Body);

/** An error body as the server sends one. */
const refusal = (tag: string, status: number) => json(Object.fromEntries([["_tag", tag]]), status);

type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** `verificationUri` stands in for a server that sends its device sign-in page elsewhere. */
export const fakeAccountServer = (
  origin: string,
  options: { readonly verificationUri?: string } = {}
) => {
  const codes = new Map<string, { challenge: string; person: FakePerson }>();
  const sessions = new Map<string, FakePerson>();
  const devices = new Map<string, FakePerson | null>();
  const calls: Array<string> = [];
  /** Each Invite's capability, and whether it can still be accepted. */
  const invites = new Map<string, { capability: string; live: boolean }>();
  let next = 0;
  let signedIn: FakePerson = { personId: "p1", login: "octocat" };

  const me = (person: FakePerson) => ({
    ...person,
    name: null,
    avatarUrl: null,
    commitEmail: `${person.login}@example.com`,
    commitEmails: [`${person.login}@example.com`],
  });

  const session = (request: Request) =>
    sessions.get((request.headers.get("authorization") ?? "").replace("Bearer ", ""));

  /** `DELETE /v1/shares/{inviteId}/devices` with the Invite's capability; null for any other call. */
  const withdraw = (request: Request, path: string): Response | null => {
    const id = /^\/v1\/shares\/([^/]+)\/devices$/.exec(path)?.[1];

    if (id === undefined || request.method !== "DELETE") return null;
    const held = invites.get(decodeURIComponent(id));
    const capability = (request.headers.get("authorization") ?? "").replace("Capability ", "");

    if (held === undefined || held.capability !== capability) return refusal("Unauthorized", 401);
    held.live = false;

    return new Response(null, { status: 204 });
  };

  /** A person lookup or a new Invite, for a signed-in session; null for any other call. */
  const invite = (request: Request, path: string): Response | null => {
    if (path === "/v1/people") {
      const login = new URL(request.url).searchParams.get("login") ?? "";

      return json({ personId: `id-of-${login}`, login, name: null, avatarUrl: null });
    }

    if (path !== "/v1/invites" || request.method !== "POST") return null;
    const inviteId = `inv${++next}`;
    const capability = `cap${next}`;
    invites.set(inviteId, { capability, live: true });

    return json({ inviteId, hostCapability: capability, relayUrl: null });
  };

  const routes = async (request: Request, path: string): Promise<Response> => {
    const raw: unknown = request.method === "GET" ? {} : await request.json().catch(() => ({}));
    const body = Option.getOrElse(decodeBody(raw), (): typeof Body.Type => ({}));

    if (path === "/v1/sign-in/token") {
      const pending = codes.get(body.code ?? "");
      codes.delete(body.code ?? "");
      const challenge = await Effect.runPromise(challengeOf(body.code_verifier ?? ""));

      if (pending === undefined || challenge !== pending.challenge)
        return refusal("InvalidGrant", 400);
      const token = `t${++next}`;
      sessions.set(token, pending.person);

      return json({ token });
    }

    if (path === "/api/auth/device/code") {
      devices.set("dc", null);

      return json({
        device_code: "dc",
        user_code: "ABCD-EFGH",
        verification_uri_complete:
          options.verificationUri ?? `${origin}/device?user_code=ABCD-EFGH`,
        expires_in: 900,
        interval: 0,
      });
    }

    if (path === "/api/auth/device/token") {
      const person = devices.get(body.device_code ?? "");

      if (person === null || person === undefined)
        return json({ error: "authorization_pending" }, 400);
      const token = `t${++next}`;
      sessions.set(token, person);

      return json({ access_token: token });
    }

    const withdrawing = withdraw(request, path);

    if (withdrawing !== null) return withdrawing;
    const person = session(request);

    if (person === undefined) return refusal("Unauthorized", 401);

    const sharing = invite(request, path);

    if (sharing !== null) return sharing;

    if (path === "/api/auth/sign-out") {
      sessions.delete((request.headers.get("authorization") ?? "").replace("Bearer ", ""));

      return json({ success: true });
    }

    if (path === "/v1/me") return json(me(person));

    if (path === "/v1/statements")
      return json({ jwt: `h.${person.personId}:${body.noiseKey ?? ""}.s` });

    return refusal("NotFound", 404);
  };

  const fetch: Fetch = async (url, init) => {
    const request = new Request(url, init);
    const path = new URL(url).pathname;
    calls.push(`${request.method} ${path}`);

    return routes(request, path);
  };

  /** What the browser is sent back to after `url` (`/sign-in?…`): GitHub signed `signedIn` in. */
  const redirectFor = (url: string, overrides: { state?: string } = {}) => {
    const params = new URL(url).searchParams;
    const code = `c${++next}`;
    codes.set(code, { challenge: params.get("code_challenge") ?? "", person: signedIn });
    const back = new URL(params.get("redirect_uri") ?? "");
    back.searchParams.set("code", code);
    back.searchParams.set("state", overrides.state ?? params.get("state") ?? "");

    return back.toString();
  };

  /** The browser as an `Authorizer`, returning to a loopback nobody listens on. */
  const browser = (overrides: { state?: string } = {}) =>
    Effect.sync((): Authorizer => ({
      redirectUri: "http://127.0.0.1:9/callback",
      open: (url) => Effect.sync(() => redirectFor(url, overrides)),
    }));

  return {
    origin,
    fetch,
    calls,
    redirectFor,
    browser,
    signInAs: (person: FakePerson) => {
      signedIn = person;
    },
    /** The server ends every session, as a revocation or expiry does. */
    endSessions: () => sessions.clear(),
    approveDevice: (person: FakePerson) => devices.set("dc", person),
    /** Every Invite made, withdrawn or not. */
    invited: () => [...invites.keys()],
    /** The Invites someone could still accept. */
    liveInvites: () => [...invites].flatMap(([id, held]) => (held.live ? [id] : [])),
  };
};

export type FakeAccountServer = ReturnType<typeof fakeAccountServer>;

/** One `fetch` routing each origin to its fake. */
export const fakeServers = (...servers: ReadonlyArray<FakeAccountServer>): Fetch => {
  const byOrigin = new Map(servers.map((s) => [s.origin, s]));

  return (url, init) => {
    const server = byOrigin.get(new URL(url).origin);

    return server === undefined
      ? Promise.reject(new TypeError("fetch failed"))
      : server.fetch(url, init);
  };
};
