/**
 * Follows one Host's feed for as long as Home is mounted: through `@polaris/client`'s resumable
 * host feed, so a Host that is offline at first, or drops, is picked up whenever it connects.
 */
import { openHostFeed } from "@polaris/client/resume";
import { Effect, Fiber, Stream } from "effect";
import { applyHostItem, emptyHostFeed, type HostFeedState } from "./fold.ts";
import { type HostLink, liveSourceOf } from "./link.ts";

export interface FollowedHost {
  readonly state: HostFeedState;
  /** True once a Snapshot arrived; until then the Host has never been seen this launch. */
  readonly seen: boolean;
  /** Set when the Daemon refused the feed itself (not a lost connection). */
  readonly error: string | null;
}

export const unseenHost: FollowedHost = { state: emptyHostFeed, seen: false, error: null };

export const followHost = (
  link: HostLink,
  onChange: (followed: FollowedHost) => void
): (() => void) => {
  let followed = unseenHost;
  let closed = false;

  const publish = (next: FollowedHost) => {
    followed = next;

    if (!closed) onChange(next);
  };

  const program = Effect.gen(function* () {
    const feed = yield* openHostFeed(liveSourceOf(link));

    yield* Stream.runForEach(feed.stream, (item) =>
      Effect.sync(() => {
        publish({ state: applyHostItem(followed.state, item), seen: true, error: null });
      })
    );
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        publish({ ...followed, error: String(cause) });
      })
    )
  );

  const fiber = Effect.runFork(program);

  return () => {
    closed = true;
    Effect.runFork(Fiber.interrupt(fiber));
  };
};
