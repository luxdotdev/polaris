/**
 * The Host's enrolled user keys and the requests from keys it doesn't know (ENG-927, ADR 0114).
 * Every step is synchronous from read to write, so two hellos can't both enrol first. Access is
 * decided per request from the enrolled set, so allowing and revoking take effect at once.
 */
import {
  EnrolledApp,
  type HostId,
  UserAccessId,
  UserAccessRequest,
  UserAccessState,
  UserKey,
} from "@polaris/protocol";
import { Option, Redacted, Result, Schema } from "effect";
import {
  digestOf,
  type Enrolment,
  readEnrolments,
  userAccessFile,
  writeEnrolments,
} from "./file.ts";

/** Open requests a Host keeps: a process making up keys can't fill the prompt past this. */
export const MAX_REQUESTS = 8;

const MAX_LABEL = 64;

const decodeKey = Schema.decodeUnknownOption(UserKey);

const idOf = (digest: string) => UserAccessId.make(digest.slice(0, 16));

/** Six characters of the digest that the id doesn't show, as `4F2-91C`. */
const codeOf = (digest: string) => `${digest.slice(16, 19)}-${digest.slice(19, 22)}`.toUpperCase();

/** A label as one short line: control and formatting characters could dress a request up. */
const cleanLabel = (label: string) => {
  const text = label
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .trim()
    .slice(0, MAX_LABEL);

  return text === "" ? "Unnamed desktop app" : text;
};

export interface UserAccessOptions {
  readonly hostId: HostId;
  /** Defaults to `~/.polaris/user-access.json`. */
  readonly file?: string | undefined;
  readonly now?: () => Date;
  /** Open requests kept at once; `MAX_REQUESTS` unless a test narrows it. */
  readonly maxRequests?: number;
}

export interface PresentedKey {
  readonly key: Redacted.Redacted<unknown> | undefined;
  /** The connection's device label, shown in the request and the enrolled list. */
  readonly label: string;
}

/** A connection, known by identity: the transport passes its `Rpc.ServerClient`. */
export interface Connection {
  readonly id: number;
}

export interface UserAccessRegistry {
  /** `hello`'s user key: enrolled, the first this Host sees, or a request. True when it holds access. */
  readonly present: (client: Connection, presented: PresentedKey) => boolean;
  /** Whether the connection's key is enrolled now. */
  readonly holds: (client: Connection) => boolean;
  /** The connection closed: its request goes when no other connection has that key. */
  readonly release: (client: Connection) => void;
  readonly stateFor: (client: Connection) => UserAccessState;
  readonly allow: (id: UserAccessId) => Option.Option<EnrolledApp>;
  readonly deny: (id: UserAccessId) => boolean;
  /** Refused for the last enrolled key: with none left, nothing could allow the next. */
  readonly revoke: (id: UserAccessId) => Result.Result<EnrolledApp, RevokeRefusal>;
  /** Calls `listener` once, when the connection stops holding user access; returns how to stop. */
  readonly onLost: (client: Connection, listener: () => void) => () => void;
  /** Calls `listener` after every change; returns how to stop. */
  readonly watch: (listener: () => void) => () => void;
}

export type RevokeRefusal = "unknown" | "last";

interface Waiting {
  readonly label: string;
  readonly requestedAt: string;
}

export const userAccessRegistry = (options: UserAccessOptions): UserAccessRegistry => {
  const file = options.file ?? userAccessFile();
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const bound = new Map<Connection, string>();
  const requests = new Map<string, Waiting>();
  const listeners = new Set<() => void>();
  const maxRequests = options.maxRequests ?? MAX_REQUESTS;
  let enrolments: ReadonlyArray<Enrolment> = [];
  const admitted = new Map<Connection, Set<() => void>>();
  let readable = false;
  let initialised = false;

  /** The file is read on `hello` and before each write, never on a request's path. */
  const reload = () => {
    const read = readEnrolments(file);

    readable = Option.isSome(read);

    if (Option.isNone(read)) return;
    enrolments = read.value.keys;
    initialised = read.value.initialised;
  };

  const save = (keys: ReadonlyArray<Enrolment>) => {
    if (!readable || !writeEnrolments(file, keys)) return false;
    enrolments = keys;
    initialised = true;

    return true;
  };

  const enrolled = (digest: string) => enrolments.some((entry) => entry.digest === digest);

  const connected = (digest: string) => [...bound.values()].includes(digest);

  const unbind = (digest: string) => {
    for (const [client, held] of bound) if (held === digest) bound.delete(client);
  };

  const appOf = (entry: Enrolment, self: string | undefined) =>
    new EnrolledApp({
      id: idOf(entry.digest),
      label: entry.label,
      enrolledAt: entry.enrolledAt,
      self: entry.digest === self,
      connected: connected(entry.digest),
    });

  const enrol = (digest: string, label: string) =>
    save([...enrolments, { digest, label, enrolledAt: now() }]);

  /** An unknown key waits, unless the file can't be trusted, nobody could allow it or the requests are full. */
  const ask = (client: Connection, digest: string, label: string) => {
    if (!readable || enrolments.length === 0) return;

    if (!requests.has(digest) && requests.size >= maxRequests) return;
    bound.set(client, digest);

    if (!requests.has(digest)) requests.set(digest, { label, requestedAt: now() });
  };

  const bind = (client: Connection, digest: string, label: string) => {
    reload();

    // Trust on first use: only on a Host that never enrolled, never on an emptied registry.
    const first = readable && !initialised && enrol(digest, label);

    if (!first && !enrolled(digest)) return ask(client, digest, label);
    bound.set(client, digest);
    // A key that waited and is now enrolled (the file was deleted meanwhile) no longer asks.
    requests.delete(digest);
  };

  const holds = (client: Connection) => {
    const digest = bound.get(client);

    return digest !== undefined && enrolled(digest);
  };

  /** What an open user-only request or stream is told when its connection no longer holds. */
  const cut = () => {
    for (const [client, lost] of admitted) {
      if (holds(client)) continue;
      admitted.delete(client);
      lost.forEach((listener) => listener());
    }
  };

  const changed = () => {
    cut();
    listeners.forEach((listener) => listener());
  };

  const onLost: UserAccessRegistry["onLost"] = (client, listener) => {
    const lost = admitted.get(client) ?? new Set();

    admitted.set(client, lost.add(listener));

    return () => lost.delete(listener);
  };

  const present: UserAccessRegistry["present"] = (client, presented) => {
    // The first key a connection presents is the one it keeps.
    if (bound.has(client)) return holds(client);

    const key =
      presented.key === undefined ? Option.none() : decodeKey(Redacted.value(presented.key));

    if (Option.isNone(key)) return false;
    bind(client, digestOf(options.hostId, key.value), cleanLabel(presented.label));
    changed();

    return holds(client);
  };

  const release: UserAccessRegistry["release"] = (client) => {
    const digest = bound.get(client);

    admitted.delete(client);

    if (digest === undefined) return;
    bound.delete(client);

    if (!connected(digest)) requests.delete(digest);
    changed();
  };

  const requestWith = (id: UserAccessId) =>
    [...requests].find(([digest]) => idOf(digest) === id) ?? null;

  const allow: UserAccessRegistry["allow"] = (id) => {
    const request = requestWith(id);

    if (request === null) return Option.none();
    const [digest, { label }] = request;

    reload();

    if (!enrolled(digest) && !enrol(digest, label)) {
      cut();

      return Option.none();
    }

    requests.delete(digest);
    changed();

    return Option.map(
      Option.fromNullishOr(enrolments.find((entry) => entry.digest === digest)),
      (entry) => appOf(entry, undefined)
    );
  };

  const deny: UserAccessRegistry["deny"] = (id) => {
    const request = requestWith(id);

    if (request === null) return false;
    requests.delete(request[0]);
    unbind(request[0]);
    changed();

    return true;
  };

  /** A refused revoke read the file again, which may have taken access from open requests. */
  const refused = (refusal: RevokeRefusal) => {
    cut();

    return Result.fail(refusal);
  };

  const revoke: UserAccessRegistry["revoke"] = (id) => {
    reload();
    const entry = enrolments.find((candidate) => idOf(candidate.digest) === id);

    if (entry === undefined) return refused("unknown");

    if (enrolments.length === 1) return refused("last");

    const app = appOf(entry, undefined);

    if (!save(enrolments.filter((candidate) => candidate !== entry))) return Result.fail("unknown");
    unbind(entry.digest);
    changed();

    return Result.succeed(app);
  };

  const stateFor: UserAccessRegistry["stateFor"] = (client) => {
    const digest = bound.get(client);

    if (digest !== undefined && enrolled(digest))
      return new UserAccessState({
        standing: "held",
        code: null,
        enrolled: enrolments.map((entry) => appOf(entry, digest)),
        requests: [...requests].map(
          ([waiting, request]) =>
            new UserAccessRequest({ id: idOf(waiting), code: codeOf(waiting), ...request })
        ),
      });

    const waiting = digest !== undefined && requests.has(digest);

    return new UserAccessState({
      standing: waiting ? "waiting" : "none",
      code: waiting ? codeOf(digest) : null,
      enrolled: [],
      requests: [],
    });
  };

  return {
    present,
    holds,
    release,
    stateFor,
    allow,
    deny,
    revoke,
    onLost,
    watch: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};
