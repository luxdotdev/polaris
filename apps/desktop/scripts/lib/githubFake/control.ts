/**
 * Moves the fake's world the way GitHub's users would: approve a device code,
 * merge, close or push to a pull request, restrict an org, inject a failure.
 * In-process tests call `api`; the smoke posts JSON to `/_fake/<action>`.
 */
import { createHash } from "node:crypto";
import { Schema } from "effect";
import type { FakeAuth } from "./auth.ts";
import { type FakeRequest, type FakeResponse, json } from "./http.ts";
import type { World } from "./world.ts";

export interface ControlInput {
  readonly world: World;
  readonly auth: FakeAuth;
  readonly failures: Array<FakeResponse>;
  readonly now: () => number;
}

const PullArgs = Schema.Struct({ repo: Schema.String, number: Schema.Number });

const ControlBody = Schema.Struct({
  userCode: Schema.optionalKey(Schema.String),
  login: Schema.optionalKey(Schema.String),
  repo: Schema.optionalKey(Schema.String),
  number: Schema.optionalKey(Schema.Number),
  org: Schema.optionalKey(Schema.String),
  restricted: Schema.optionalKey(Schema.Boolean),
  status: Schema.optionalKey(Schema.Number),
});

const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(ControlBody));

export const newControl = ({ world, auth, failures, now }: ControlInput) => {
  const pull = (repo: string, number: number) => {
    const found = world.pulls.find(
      (p) => p.repo.toLowerCase() === repo.toLowerCase() && p.number === number
    );

    if (found === undefined) throw new Error(`the fake has no pull ${repo}#${number}`);

    return found;
  };

  const touch = (repo: string, number: number) => {
    const p = pull(repo, number);

    p.updatedAt = new Date(now()).toISOString();

    return p;
  };

  const api = {
    /** The user enters the code in the browser, signed in as `login`. */
    approveDevice: (userCode: string, login: string) => auth.approve(userCode, login),
    denyDevice: (userCode: string) => auth.deny(userCode),
    pendingUserCodes: () => auth.pendingCodes(),
    expireAccessTokens: () => auth.expireAccessTokens(),
    revoke: (login: string) => auth.revokeAll(login),
    merge: (repo: string, number: number) => {
      const p = touch(repo, number);

      p.state = "MERGED";
      p.mergedAt = p.updatedAt;
      p.closedAt = p.updatedAt;
    },
    close: (repo: string, number: number) => {
      const p = touch(repo, number);

      p.state = "CLOSED";
      p.closedAt = p.updatedAt;
    },
    /** New commits: threads go outdated and Viewed files become "changed since viewed". */
    push: (repo: string, number: number) => {
      const p = touch(repo, number);

      p.headRefOid = createHash("sha1").update(`${p.headRefOid}+`).digest("hex");

      for (const thread of world.threads)
        if (thread.pullId === p.id && thread.subjectType === "LINE") thread.line = null;

      for (const [key, state] of world.viewed)
        if (key.startsWith(`${p.id}:`) && state === "VIEWED") world.viewed.set(key, "DISMISSED");
    },
    requestReview: (repo: string, number: number, login: string) => {
      const p = touch(repo, number);

      if (!p.reviewRequests.includes(login)) p.reviewRequests.push(login);
    },
    restrictOrg: (org: string, restricted: boolean) => {
      for (const o of world.orgs) if (o.login === org) o.restricted = restricted;
    },
    /** The next request (any) answers `status` instead. */
    failNext: (status: number) => failures.push(json(status, { message: `injected ${status}` })),
  };

  const withPull = (body: typeof ControlBody.Type, run: (repo: string, number: number) => void) => {
    const { repo, number } = Schema.decodeUnknownSync(PullArgs)(body);

    run(repo, number);
  };

  const actions = new Map<string, (body: typeof ControlBody.Type) => void>(
    Object.entries({
      approve: (b) =>
        api.approveDevice(b.userCode ?? api.pendingUserCodes().at(-1) ?? "", b.login ?? "mona"),
      deny: (b) => api.denyDevice(b.userCode ?? api.pendingUserCodes().at(-1) ?? ""),
      expire: () => api.expireAccessTokens(),
      merge: (b) => withPull(b, api.merge),
      close: (b) => withPull(b, api.close),
      push: (b) => withPull(b, api.push),
      "request-review": (b) =>
        withPull(b, (repo, number) => api.requestReview(repo, number, b.login ?? "mona")),
      restrict: (b) => api.restrictOrg(b.org ?? "", b.restricted ?? true),
      fail: (b: typeof ControlBody.Type) => api.failNext(b.status ?? 502),
    })
  );

  const handle = (request: FakeRequest): FakeResponse => {
    const action = actions.get(request.path.slice("/_fake/".length));

    if (action === undefined) return json(404, { message: "no such control" });
    action(decodeBody(request.body === "" ? "{}" : request.body));

    return json(200, { ok: true, pendingUserCodes: api.pendingUserCodes() });
  };

  return { api, handle };
};
