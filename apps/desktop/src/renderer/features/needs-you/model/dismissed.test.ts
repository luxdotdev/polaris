import { describe, expect, test } from "bun:test";
import { HOSTS, MODELS } from "../../sessions/preview/fixtures.ts";
import { applyDismissed, stampOf } from "./dismissed.ts";
import { buildInbox } from "./inbox.ts";

const inbox = buildInbox({ hosts: HOSTS, models: MODELS, now: 0, answeredHere: new Set() });

const first = inbox.waiting[0]!;

describe("applyDismissed", () => {
  test("the fixtures have something waiting", () => {
    expect(inbox.waiting.length).toBeGreaterThan(0);
  });

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

  test("an Also item's stamp follows its kind and when its session changed", () => {
    const also = inbox.also[0];

    if (also === undefined) return;
    expect(stampOf(also)).toBe(`${also.kind}:${also.entry.session.updatedAt}`);
    expect(applyDismissed(inbox, new Map([[also.key, stampOf(also)]])).inbox.also).not.toContain(
      also
    );
  });
});
