import { describe, expect, test } from "bun:test";
import { HOSTS, MODELS } from "../../sessions/preview/fixtures.ts";
import { applyDismissed, stampOf } from "./dismissed.ts";
import { buildInbox } from "./inbox.ts";
import { host, hostModel, minutes, sessionWith } from "./inbox.testing.ts";

const inbox = buildInbox({ hosts: HOSTS, models: MODELS, now: 0, answeredHere: new Set() });

const first = inbox.waiting[0]!;

describe("applyDismissed", () => {
  test("a dismissed item is hidden on this Mac and leaves the count", () => {
    const result = applyDismissed(inbox, new Map([[first.key, stampOf(first)]]));

    expect(result.inbox.waiting.some((w) => w.key === first.key)).toBe(false);
    expect(result.inbox.count).toBe(inbox.count - 1);
    expect(result.hidden).toBe(1);
    expect(result.quiet.has(first.key)).toBe(true);
    expect(result.current.get(first.key)).toBe(stampOf(first));
  });

  test("new activity brings it back and forgets the dismissal", () => {
    const result = applyDismissed(inbox, new Map([[first.key, "requests:an-older-request"]]));

    expect(result.inbox.waiting.some((w) => w.key === first.key)).toBe(true);
    expect(result.inbox.count).toBe(inbox.count);
    expect(result.hidden).toBe(0);
    expect(result.current.has(first.key)).toBe(false);
  });

  test("a dismissal for an item not in the inbox now (its Host connecting) is kept", () => {
    const result = applyDismissed(inbox, new Map([["elsewhere\u0000s9", "requests:r1"]]));

    expect(result.current.get("elsewhere\u0000s9")).toBe("requests:r1");
    expect(result.hidden).toBe(0);
  });

  test("an Also item comes back when its session changes, not before", () => {
    const failedAt = (updatedAt: string) =>
      buildInbox({
        hosts: [host("local", "Mac Studio")],
        models: {
          local: hostModel([{ session: sessionWith("f", { state: "failed", updatedAt }) }]),
        },
        now: 0,
        answeredHere: new Set(),
      });

    const before = failedAt(minutes(1));
    const [failed] = before.also;

    if (failed === undefined) throw new Error("a Failed session is an Also item");
    const dismissed = new Map([[failed.key, stampOf(failed)]]);

    const unchanged = applyDismissed(failedAt(minutes(1)), dismissed);

    expect(unchanged.inbox.also).toEqual([]);
    expect(unchanged.hidden).toBe(1);

    const changed = applyDismissed(failedAt(minutes(2)), dismissed);

    expect(changed.inbox.also.map((a) => a.key)).toEqual([failed.key]);
    expect(changed.hidden).toBe(0);
    expect(changed.current.has(failed.key)).toBe(false);
  });
});
