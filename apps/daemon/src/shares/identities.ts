/**
 * Co-author trailers read a Teammate's name and commit email from the Host's Shares (ENG-941).
 * The Engine is built before the Share service, so it reads them through this book, which the
 * Share service fills once it is up; until then the Host has no Shares.
 */
import type { Share } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import { CommitIdentities, identitiesFromShares } from "../coAuthors/index.ts";

export class ShareBook extends Context.Service<
  ShareBook,
  {
    /** Every Share of the Host, ended ones included. */
    readonly all: Effect.Effect<ReadonlyArray<Share>>;
    readonly bind: (shares: Effect.Effect<ReadonlyArray<Share>>) => void;
  }
>()("polaris/daemon/shares/ShareBook") {
  static readonly layer = Layer.sync(ShareBook, () => {
    let source = Effect.succeed<ReadonlyArray<Share>>([]);

    return ShareBook.of({
      all: Effect.suspend(() => source),
      bind: (shares) => {
        source = shares;
      },
    });
  });
}

/** `CommitIdentities` from the Share store, with the book the Share service binds. */
export const CommitIdentitiesLive = Layer.effect(CommitIdentities)(
  Effect.map(ShareBook, (book) => identitiesFromShares(book.all))
).pipe(Layer.provideMerge(ShareBook.layer));
