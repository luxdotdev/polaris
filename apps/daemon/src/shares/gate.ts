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
  TurnId,
} from "@polaris/protocol";
import { Effect, Option, Predicate, Schema } from "effect";
import type { Rpc } from "effect/rpc";
import { actorOf, pairingOf } from "../extensions/connection.ts";
import { WorkingTreeFallback } from "../git/diffScope.ts";
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
    Schema.Struct({
      _tag: Schema.String,
      sessionId: Schema.optionalKey(SessionId),
      turnId: Schema.optionalKey(TurnId),
      firstTurnId: Schema.optionalKey(TurnId),
      lastTurnId: Schema.optionalKey(TurnId),
    })
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
  /** The Turns a `git.diff` names, first to last; empty for anything else. */
  readonly turnIds: ReadonlyArray<TurnId>;
}

const NOTHING: RequestSubject = {
  command: null,
  sessionId: null,
  constellationId: null,
  cwd: null,
  turnIds: [],
};

/** The Turns a diff spec names: one Turn, or the first and last of a run. */
const turnsOf = (spec: (typeof Subject.Type)["spec"]): ReadonlyArray<TurnId> =>
  [spec?.turnId, spec?.firstTurnId, spec?.lastTurnId].filter((id) => id !== undefined);

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
    return {
      ...NOTHING,
      sessionId: subject.spec?.sessionId ?? null,
      cwd: subject.cwd ?? null,
      turnIds: turnsOf(subject.spec),
    };

  if (rpc === "shares.watchPresence" || rpc === "shares.mute")
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

/**
 * The Turns of a diff as the Host knows them: `missing` when one is not the session's or the
 * run is backwards, `working` when the last has not ended, else `ended`.
 */
export type DiffTurns = "missing" | "working" | "ended";

export interface TeammateRequest {
  readonly shares: ReadonlyArray<Share>;
  readonly now: number;
  readonly rpc: string;
  readonly subject: RequestSubject;
  readonly touch: ShareTouch;
  /** Where the subject's session runs; null without one. */
  readonly sessionCwd: string | null;
  /** What Host state says of the Turns a `git.diff` names; null for any other request. */
  readonly diffTurns: DiffTurns | null;
  /** Whether Teammates may send Turns yet (`teammatesMayAct`); approvals are always theirs to answer. */
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

  // Its Turns are the shared session's own: an unknown one would diff the whole working tree.
  if (rpc === "git.diff" && request.diffTurns !== "working" && request.diffTurns !== "ended")
    return new NotShared({ what: rpc });
  const access = commandAccess(subject.command);

  if (rpc === "dispatch" && !request.mayAct && access === "turn")
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

/** What Host state says of the Turns `subject` names; null when it names none. */
export const diffTurnsOf = (
  targets: ShareTargets,
  subject: RequestSubject
): Effect.Effect<DiffTurns | null> => {
  const { sessionId, turnIds } = subject;

  if (sessionId === null || turnIds.length === 0) return Effect.succeed(null);

  return Effect.map(
    Effect.forEach(turnIds, (turnId) => targets.turn(sessionId, turnId)),
    (turns): DiffTurns => {
      const first = turns[0] ?? null;
      const last = turns.at(-1) ?? null;

      if (first === null || last === null || first.index > last.index) return "missing";

      return last.working ? "working" : "ended";
    }
  );
};

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
      const diff = Predicate.isTagged(rpc, "git.diff");
      const diffTurns = diff ? yield* diffTurnsOf(shares.targets, subject) : null;

      const refusal = decideTeammate({
        shares: mine,
        now: now(),
        rpc: rpc._tag,
        subject,
        touch,
        sessionCwd: cwd,
        diffTurns,
        mayAct: teammatesMayAct(),
      });

      if (refusal !== null) return yield* refusal;
      const share = coveringShare(mine, now(), touch);

      if (share === null) return yield* effect;
      const actor = teammateActor(share);

      // Only a Turn still working may be read up to the working tree as it stands.
      const scoped = Effect.provideService(effect, RequestShare, {
        actor,
        grant: share.grant,
        role: share.role,
      }).pipe(Effect.provideService(WorkingTreeFallback, !diff || diffTurns === "working"));

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
