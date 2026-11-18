/**
 * Queued Turns the Host would not start (ENG-941): each one, once, worded for its toast. A
 * sender who lost access, or a Turn before it that did not finish, would otherwise vanish.
 */
import type { HostModel, QueueDrop } from "../../../store/hostModel.ts";

export const QUEUE_DROP_TITLE = "A queued turn didn't start";

/** "Fix the login redirect: their share ended", so the toast names the session. */
export const queueDropMessage = (title: string, drop: QueueDrop): string =>
  `${title || "Untitled session"}: ${drop.reason.charAt(0).toLowerCase()}${drop.reason.slice(1)}`;

/** The drops not yet in `seen`, which it then holds, each with its session's title. */
export const unseenQueueDrops = (
  models: Readonly<Record<string, HostModel>>,
  seen: WeakSet<QueueDrop>
): ReadonlyArray<{ readonly title: string; readonly drop: QueueDrop }> =>
  Object.values(models).flatMap((model) =>
    [...model.sessions.values()].flatMap(({ lastQueueDrop: drop, session }) => {
      if (drop === undefined || seen.has(drop)) return [];
      seen.add(drop);

      return [{ title: session.title, drop }];
    })
  );
