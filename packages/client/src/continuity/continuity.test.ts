import { describe, expect, test } from "bun:test";
import { ComposerDraft, ContinuityItem, ReadPosition, SessionId, TurnId } from "@polaris/protocol";
import {
  applyContinuity,
  type DraftStatus,
  type DraftSyncOptions,
  emptyContinuity,
  makeDraftSync,
} from "./index.ts";

const sessionId = SessionId.make("s-1");

const at = "2026-10-27T00:00:00.000Z";

const draft = (text: string, revision: number) =>
  new ComposerDraft({ sessionId, text, revision, at });

interface Reply {
  readonly text: string;
  readonly resolve: (value: ComposerDraft | null) => void;
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A Host that numbers saves like the Daemon, a manual clock, and what the composer shows. */
const harness = (overrides: Partial<DraftSyncOptions> = {}) => {
  let revision = 0;
  let timers: Array<() => void> = [];
  const saves: Array<string> = [];
  const shown: Array<string> = [];
  const statuses: Array<DraftStatus> = [];
  const replies: Array<Reply> = [];
  /** What the Host holds: the text of the last save it answered ok. */
  const host = { text: "" };

  const reply = async (which: "oldest" | "newest", ok: boolean) => {
    const { text, resolve } = (which === "oldest" ? replies.shift() : replies.pop())!;

    if (ok) host.text = text;
    resolve(ok ? draft(text, ++revision) : null);
    await settle();
  };

  const sync = makeDraftSync({
    save: (_, text) => {
      saves.push(text);

      return new Promise((resolve) => replies.push({ text, resolve }));
    },
    adopt: (_, text) => void shown.push(text),
    status: (_, status) => void statuses.push(status),
    schedule: (run) => {
      timers.push(run);

      return () => {
        timers = timers.filter((t) => t !== run);
      };
    },
    ...overrides,
  });

  return {
    sync,
    saves,
    shown,
    statuses,
    /** The pause after typing passes. */
    pause: () => {
      const due = timers;
      timers = [];
      due.forEach((run) => run());
    },
    host,
    /** The Host answers the oldest save. */
    answer: (ok = true) => reply("oldest", ok),
    /** The Host answers the newest save waiting, as a replacement connection can. */
    answerNewest: (ok = true) => reply("newest", ok),
    outstanding: () => replies.length,
    /** Another Client saved. */
    elsewhere: (text: string) => draft(text, ++revision),
  };
};

describe("draft sync", () => {
  test("typing writes once, after the pause, with the latest text", async () => {
    const h = harness();
    h.sync.edit(sessionId, "F");
    h.sync.edit(sessionId, "Fi");
    h.sync.edit(sessionId, "Fix");
    expect(h.saves).toEqual([]);
    h.pause();
    expect(h.saves).toEqual(["Fix"]);
    await h.answer();
    expect(h.statuses).toEqual(["saving", "saved"]);
  });

  test("another Client's draft replaces an idle composer, but not its own echo", async () => {
    const h = harness();
    h.sync.edit(sessionId, "mine");
    h.pause();
    await h.answer();
    h.sync.receive(draft("mine", 1));
    h.sync.receive(h.elsewhere("theirs"));
    expect(h.shown).toEqual(["theirs"]);
  });

  test("a draft from elsewhere while typing here loses to the typing", async () => {
    const h = harness();
    h.sync.edit(sessionId, "typing");
    h.sync.receive(h.elsewhere("theirs"));
    h.pause();
    await h.answer();
    expect(h.shown).toEqual([]);
  });

  test("a draft saved elsewhere after this Client's write is adopted once the write lands", async () => {
    const h = harness();
    h.sync.edit(sessionId, "mine");
    h.pause();
    // The Host numbered this Client's write first, then the other's.
    const ours = h.answer();
    h.sync.receive(draft("theirs", 2));
    await ours;
    expect(h.shown).toEqual(["theirs"]);
  });

  test("a failed write says so and goes again on flush", async () => {
    const h = harness();
    h.sync.edit(sessionId, "Fix");
    h.pause();
    await h.answer(false);
    expect(h.statuses.at(-1)).toBe("unsaved");
    const flushed = h.sync.flush(sessionId);
    expect(h.saves).toEqual(["Fix", "Fix"]);
    await h.answer();
    await flushed;
    expect(h.statuses.at(-1)).toBe("saved");
  });
});

describe("overlapping writes", () => {
  // Each order: which save the Host answers first, then the other; the first one succeeds.
  test.each(["newest", "oldest"] as const)(
    "a newer draft that was saved stays saved when %s answers first and the other fails",
    async (first) => {
      const h = harness();
      h.sync.edit(sessionId, "old");
      h.pause();
      h.sync.edit(sessionId, "new");
      h.pause();

      await (first === "newest" ? h.answerNewest(true) : h.answer(true));

      while (h.outstanding() > 0) await h.answer(false);
      const flushed = h.sync.flush(sessionId);

      while (h.outstanding() > 0) await h.answer(true);
      await flushed;

      expect(h.host.text).toBe("new");
      expect(h.statuses.at(-1)).toBe("saved");
    }
  );

  test("flush writes the latest typing even while an older write is in flight", async () => {
    const h = harness();
    h.sync.edit(sessionId, "old");
    h.pause();
    h.sync.edit(sessionId, "new");
    const flushed = h.sync.flush(sessionId);

    while (h.outstanding() > 0) await h.answer(true);
    await flushed;

    expect(h.host.text).toBe("new");
  });

  test("retry writes what failed, once the Host is back", async () => {
    const h = harness();
    h.sync.edit(sessionId, "Fix");
    h.pause();
    await h.answer(false);
    const retried = h.sync.retry();
    await h.answer(true);
    await retried;

    expect(h.host.text).toBe("Fix");
  });
});

describe("applyContinuity", () => {
  const read = (turnIndex: number) =>
    new ReadPosition({ sessionId, turnId: TurnId.make(`t-${turnIndex}`), turnIndex, at });

  test("a read position or draft older than the one held is ignored", () => {
    const state = [
      ContinuityItem.cases.Snapshot.make({ reads: [read(3)], drafts: [draft("b", 2)] }),
      ContinuityItem.cases.Read.make({ position: read(1) }),
      ContinuityItem.cases.Draft.make({ draft: draft("a", 1) }),
    ].reduce(applyContinuity, emptyContinuity);

    expect(state.reads.get(sessionId)?.turnIndex).toBe(3);
    expect(state.drafts.get(sessionId)?.text).toBe("b");
  });
});
