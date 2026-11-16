/**
 * The Share gate (ADR 0112): a Teammate's connection reaches only what its person's live
 * Shares cover, by role and Grant, and the request that passes carries the Share it acts
 * through. Any other connection passes untouched. It also records who has a feed open.
 */
import {
  type Actor,
  ConstellationId,
  decideShareAccess,
  isShareLive,
  NotGranted,
  NotShared,
  SessionId,
  type Share,
  SHARE_COMMANDS,
  shareCovers,
  ShareGate,
  ShareTarget,
  type ShareTouch,
} from "@polaris/protocol";
import { Effect, Option, Schema } from "effect";
import type { Rpc } from "effect/rpc";
import { actorOf, pairingOf } from "../extensions/connection.ts";
import { teammatesMayAct } from "../transport/userAccess.ts";
import { RequestShare, type TeammateDevice } from "./connection.ts";
import { type Shares, type ShareTargets, teammateActor } from "./service.ts";

/** What a request names, wherever its payload puts it. */
const Subject = Schema.Struct({
  sessionId: Schema.optionalKey(SessionId),
  constellationId: Schema.optionalKey(ConstellationId),
  cwd: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(
    Schema.Struct({ _tag: Schema.String, sessionId: Schema.optionalKey(SessionId) })
  ),
  spec: Schema.optionalKey(
    Schema.Struct({ _tag: Schema.String, sessionId: Schema.optionalKey(SessionId) })
  ),
  target: Schema.optionalKey(ShareTarget),
});

/** Reads what a request names out of its payload; none when it names nothing readable. */
export const decodeSubject = Schema.decodeUnknownOption(Subject);

export interface RequestSubject {
  /** The Command's tag for `dispatch`; null for every other RPC. */
  readonly command: string | null;
  readonly sessionId: SessionId | null;
  readonly constellationId: ConstellationId | null;
  /** The directory a `git.diff` asks about. */
  readonly cwd: string | null;
}

const NOTHING: RequestSubject = {
  command: null,
  sessionId: null,
  constellationId: null,
  cwd: null,
};

const ofTarget = (target: ShareTarget): ShareTouch =>
  ShareTarget.match(target, {
    Session: ({ sessionId }): ShareTouch => ({ sessionId, constellationId: null }),
    Constellation: ({ constellationId }): ShareTouch => ({ sessionId: null, constellationId }),
  });

/** The session or Constellation a payload names for `rpc`; nothing for a Host-wide call. */
export const subjectOf = (
  rpc: string,
  decoded: Option.Option<typeof Subject.Type>
): RequestSubject => {
  const subject = Option.getOrNull(decoded);

  if (subject === null) return NOTHING;

  if (rpc === "dispatch")
    return {
      ...NOTHING,
      command: subject.command?._tag ?? null,
      sessionId: subject.command?.sessionId ?? null,
    };

  // A diff of the working tree or a range names a path, which no Share covers.
  if (rpc === "git.diff")
    return { ...NOTHING, sessionId: subject.spec?.sessionId ?? null, cwd: subject.cwd ?? null };

  if (rpc === "shares.watchPresence")
    return subject.target === undefined ? NOTHING : { ...NOTHING, ...ofTarget(subject.target) };

  return {
    ...NOTHING,
    sessionId: subject.sessionId ?? null,
    constellationId: subject.constellationId ?? null,
  };
};

const commandAccess = (command: string | null): string | null => {
  const table: Readonly<Record<string, string>> = SHARE_COMMANDS;

  return command !== null && Object.hasOwn(table, command) ? (table[command] ?? null) : null;
};

export interface TeammateRequest {
  readonly shares: ReadonlyArray<Share>;
  readonly now: number;
  readonly rpc: string;
  readonly subject: RequestSubject;
  readonly touch: ShareTouch;
  /** Where the subject's session runs; null without one. */
  readonly sessionCwd: string | null;
  /** Whether Teammates may send Turns and answer approvals yet (`teammatesMayAct`). */
  readonly mayAct: boolean;
}

/** The refusal for a Teammate's request, or null when its Shares allow it. */
export const decideTeammate = (request: TeammateRequest): NotShared | NotGranted | null => {
  const { rpc, subject } = request;

  const refusal = decideShareAccess(
    request.shares,
    request.now,
    rpc,
    subject.command,
    request.touch
  );

  if (refusal !== null) return refusal;

  // A session's diff is read where that session runs, never in a directory the Teammate names.
  if (rpc === "git.diff" && subject.cwd !== request.sessionCwd) return new NotShared({ what: rpc });
  const access = commandAccess(subject.command);

  if (rpc === "dispatch" && !request.mayAct && (access === "turn" || access === "approve"))
    return new NotGranted({ what: `dispatch:${subject.command ?? ""}`, needed: access });

  return null;
};

/** The live Share a request acts through: a Contributor's when one covers it. */
export const coveringShare = (
  shares: ReadonlyArray<Share>,
  now: number,
  touch: ShareTouch
): Share | null => {
  const covering = shares.filter(
    (share) => isShareLive(share, now) && shareCovers(share.target, touch)
  );

  return covering.find((share) => share.role === "contributor") ?? covering[0] ?? null;
};

/** The feeds that count as having a target open. */
const FEEDS: ReadonlySet<string> = new Set(["subscribeSession", "constellation.subscribe"]);

const touchOf = (
  targets: ShareTargets,
  subject: RequestSubject
): Effect.Effect<{ readonly touch: ShareTouch; readonly cwd: string | null }> =>
  subject.sessionId === null
    ? Effect.succeed({
        touch: { sessionId: null, constellationId: subject.constellationId },
        cwd: null,
      })
    : Effect.map(targets.session(subject.sessionId), (found) =>
        found === null
          ? { touch: { sessionId: subject.sessionId, constellationId: null }, cwd: null }
          : { touch: found.touch, cwd: found.cwd }
      );

export const shareGateFor = (options: {
  readonly shares: Shares["Service"];
  /** The Teammate a connection came in as, from the transport rather than annotations. */
  readonly teammateOf: (client: Rpc.ServerClient) => TeammateDevice | null;
  readonly now?: () => number;
}) => {
  const { shares } = options;
  const now = options.now ?? Date.now;

  /** `effect`, with its connection listed as viewing `touch` for as long as it runs. */
  const viewing = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    viewer: { readonly person: string; readonly actor: Actor; readonly avatarUrl: string | null },
    touch: ShareTouch
  ) =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        shares.presence.enter({ ...viewer, touch, since: new Date(now()).toISOString() })
      ),
      () => effect,
      (leave) => Effect.sync(leave)
    );

  return ShareGate.of((effect, { client, rpc, payload }) => {
    const teammate = options.teammateOf(client);
    const subject = subjectOf(rpc._tag, decodeSubject(payload));

    if (teammate === null) {
      // The owner's own Clients and Linked Devices; an Extension is no person watching.
      if (!FEEDS.has(rpc._tag) || pairingOf(client) !== null) return effect;

      return Effect.flatMap(touchOf(shares.targets, subject), ({ touch }) =>
        viewing(effect, { person: "owner", actor: actorOf(client), avatarUrl: null }, touch)
      );
    }

    return Effect.gen(function* () {
      const { touch, cwd } = yield* touchOf(shares.targets, subject);
      const mine = shares.sharesOf(teammate);

      const refusal = decideTeammate({
        shares: mine,
        now: now(),
        rpc: rpc._tag,
        subject,
        touch,
        sessionCwd: cwd,
        mayAct: teammatesMayAct(),
      });

      if (refusal !== null) return yield* refusal;
      const share = coveringShare(mine, now(), touch);

      if (share === null) return yield* effect;
      const actor = teammateActor(share);
      const scoped = Effect.provideService(effect, RequestShare, { actor, grant: share.grant });

      if (!FEEDS.has(rpc._tag)) return yield* scoped;

      return yield* viewing(
        scoped,
        {
          person: `${share.issuer} ${share.person.id}`,
          actor,
          avatarUrl: share.person.avatarUrl,
        },
        touch
      );
    });
  });
};
