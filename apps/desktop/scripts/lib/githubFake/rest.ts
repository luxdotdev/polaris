/** The fake's REST: `/user`, the open pulls of a repository (with ETags), and creating a pull. */
import { createHash } from "node:crypto";
import { Option, Schema } from "effect";
import { type FakeRequest, type FakeResponse, json, notFound } from "./http.ts";
import {
  type FakePull,
  type FakeUser,
  type World,
  findRepo,
  newId,
  permissionOf,
} from "./world.ts";

const NewPull = Schema.Struct({
  title: Schema.String,
  head: Schema.String,
  base: Schema.String,
  body: Schema.optionalKey(Schema.String),
  draft: Schema.optionalKey(Schema.Boolean),
});

const decodeNewPull = Schema.decodeUnknownOption(Schema.fromJsonString(NewPull));

const restPull = (pull: FakePull, world: World) => ({
  url: `https://api.github.com/repos/${pull.repo}/pulls/${pull.number}`,
  node_id: pull.id,
  number: pull.number,
  state: pull.state === "OPEN" ? "open" : "closed",
  title: pull.title,
  body: pull.body,
  draft: pull.isDraft,
  html_url: `https://github.com/${pull.repo}/pull/${pull.number}`,
  user: { login: pull.author, id: world.users.find((u) => u.login === pull.author)?.id ?? 0 },
  created_at: pull.createdAt,
  updated_at: pull.updatedAt,
  merged_at: pull.mergedAt,
  closed_at: pull.closedAt,
  head: { ref: pull.headRefName, sha: pull.headRefOid },
  base: { ref: pull.baseRefName, sha: pull.baseRefOid },
  requested_reviewers: pull.reviewRequests.map((login) => ({ login })),
  requested_teams: [],
});

const etagOf = (body: string) => `"${createHash("sha1").update(body).digest("hex")}"`;

export interface RestInput {
  readonly world: World;
  readonly user: FakeUser;
  readonly request: FakeRequest;
  readonly now: () => number;
}

const PULLS = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/;

const listPulls = ({ world, user, request }: RestInput, owner: string, name: string) => {
  const repo = findRepo(world, owner, name);

  if (repo === undefined || permissionOf(world, user, repo) === null) return notFound();

  const state = request.query.get("state") ?? "open";

  const pulls = world.pulls
    .filter((p) => p.repo.toLowerCase() === `${owner}/${name}`.toLowerCase())
    .filter((p) => state === "all" || (state === "open") === (p.state === "OPEN"))
    .map((p) => restPull(p, world));

  const body = JSON.stringify(pulls);
  const etag = etagOf(body);

  if (request.headers.get("if-none-match") === etag)
    return { status: 304, headers: { etag }, body: "" };

  return json(200, pulls, { etag });
};

const createPull = ({ world, user, request, now }: RestInput, owner: string, name: string) => {
  const repo = findRepo(world, owner, name);
  const input = decodeNewPull(request.body);

  if (repo === undefined || permissionOf(world, user, repo) === null) return notFound();

  if (Option.isNone(input)) return json(422, { message: "Validation Failed" });

  const { title, head, base, body = "", draft = false } = input.value;
  const at = new Date(now()).toISOString();

  const pull: FakePull = {
    id: newId(world, "PR"),
    repo: `${repo.owner}/${repo.name}`,
    number: 100 + world.pulls.length,
    title,
    body,
    author: user.login,
    state: "OPEN",
    isDraft: draft,
    headRefName: head,
    headRefOid: createHash("sha1").update(head).digest("hex"),
    baseRefName: base,
    baseRefOid: createHash("sha1").update(base).digest("hex"),
    createdAt: at,
    updatedAt: at,
    reviewRequests: [],
    reviewDecision: "REVIEW_REQUIRED",
    files: [],
    mergedAt: null,
    closedAt: null,
  };

  world.pulls.push(pull);

  return json(201, restPull(pull, world));
};

/** Null when the path isn't one the fake serves. */
export const rest = (input: RestInput): FakeResponse | null => {
  const { request, user } = input;
  const pulls = PULLS.exec(request.path);

  if (request.method === "GET" && request.path === "/user") {
    return json(200, {
      login: user.login,
      id: user.id,
      name: user.name,
      avatar_url: user.avatar_url,
      type: "User",
    });
  }

  if (pulls?.[1] === undefined || pulls[2] === undefined) return null;

  if (request.method === "GET") return listPulls(input, pulls[1], pulls[2]);

  if (request.method === "POST") return createPull(input, pulls[1], pulls[2]);

  return null;
};
