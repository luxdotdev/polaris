/**
 * Where a Teammate's commit email comes from: the Share they acted through, whose person the
 * Account Server's statement filled in. The default knows no Shares, so nothing is credited.
 */
import type { Share } from "@polaris/protocol";
import { Context, Effect } from "effect";
import type { CommitIdentity, TeammateActor } from "./trailers.ts";

export interface CommitIdentitiesService {
  /** False while this Host has never had a Share: no Teammate can have contributed. */
  readonly any: Effect.Effect<boolean>;
  /** Null when the Share is unknown or its person names no commit email. */
  readonly identify: (teammate: TeammateActor) => Effect.Effect<CommitIdentity | null>;
}

const none: CommitIdentitiesService = {
  any: Effect.succeed(false),
  identify: () => Effect.succeed(null),
};

export class CommitIdentities extends Context.Reference<CommitIdentitiesService>(
  "polaris/daemon/coAuthors/CommitIdentities",
  { defaultValue: () => none }
) {}

/**
 * Identities from the Host's Shares, ended ones included: a revoked Teammate's Turns stay
 * theirs. The name is the Share's person's, else the one the Teammate acted under.
 */
export const identitiesFromShares = (
  shares: Effect.Effect<ReadonlyArray<Share>>
): CommitIdentitiesService => ({
  any: Effect.map(shares, (all) => all.length > 0),
  identify: (teammate) =>
    Effect.map(shares, (all) => {
      const person = all.find(
        (share) => share.id === teammate.shareId && share.person.id === teammate.personId
      )?.person;

      return person?.commitEmail == null
        ? null
        : { name: person.name || teammate.name, email: person.commitEmail };
    }),
});
