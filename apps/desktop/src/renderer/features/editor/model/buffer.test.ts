import { describe, expect, test } from "bun:test";
import { type BufferModel, canSave, type DiskText, loaded, sameVersion, step } from "./buffer.ts";

const disk = (text: string, n = 1): DiskText => ({
  text,
  version: { mtimeMs: n, size: text.length, hash: `h:${text}` },
});

const dirty = (model: BufferModel) => step(model, { kind: "edited", dirty: true }).model;

describe("a clean buffer", () => {
  test("reloads in place when the disk changes", () => {
    const next = step(loaded(disk("a")), { kind: "disk", disk: disk("b", 2), doc: "a", by: null });

    expect(next.effect).toEqual({ kind: "reload", text: "b" });
    expect(next.model.base).toBe("b");
    expect(next.model.conflict).toBeNull();
  });

  test("ignores a change that leaves the same version", () => {
    const model = loaded(disk("a"));

    expect(step(model, { kind: "disk", disk: disk("a"), doc: "a", by: null }).model).toBe(model);
  });

  test("a touch that keeps the bytes is the same version", () => {
    expect(
      sameVersion({ mtimeMs: 1, size: 1, hash: "x" }, { mtimeMs: 9, size: 1, hash: "x" })
    ).toBe(true);
  });
});

describe("unsaved edits", () => {
  test("a disk change becomes the conflict, naming the agent", () => {
    const next = step(dirty(loaded(disk("a"))), {
      kind: "disk",
      disk: disk("b", 2),
      doc: "mine",
      by: "Claude Code",
    });

    expect(next.effect).toBeNull();
    expect(next.model.conflict).toEqual({ theirs: disk("b", 2), by: "Claude Code" });
    expect(canSave(next.model)).toBe(false);
  });

  test("a disk change to exactly the buffer's text settles it", () => {
    const next = step(dirty(loaded(disk("a"))), {
      kind: "disk",
      disk: disk("b", 2),
      doc: "b",
      by: null,
    });

    expect(next.model.dirty).toBe(false);
    expect(next.model.conflict).toBeNull();
  });

  test("keep mine saves against their version next", () => {
    const conflicted = step(dirty(loaded(disk("a"))), {
      kind: "disk",
      disk: disk("b", 2),
      doc: "mine",
      by: null,
    }).model;

    const kept = step(conflicted, { kind: "keep-mine" });

    expect(kept.effect).toBeNull();
    expect(kept.model.version).toEqual(disk("b", 2).version);
    expect(kept.model.dirty).toBe(true);
    expect(canSave(kept.model)).toBe(true);
  });

  test("take theirs reloads and drops the edits", () => {
    const conflicted = step(dirty(loaded(disk("a"))), {
      kind: "disk",
      disk: disk("b", 2),
      doc: "mine",
      by: null,
    }).model;

    const taken = step(conflicted, { kind: "take-theirs" });

    expect(taken.effect).toEqual({ kind: "reload", text: "b" });
    expect(taken.model.dirty).toBe(false);
  });
});

describe("saving", () => {
  test("a save that lands makes the buffer clean, unless typing went on", () => {
    const saving = step(dirty(loaded(disk("a"))), { kind: "save-started", text: "ab" }).model;
    const version = disk("ab", 2).version;

    expect(step(saving, { kind: "saved", version, doc: "ab" }).model.dirty).toBe(false);
    expect(step(saving, { kind: "saved", version, doc: "abc" }).model.dirty).toBe(true);
    expect(step(saving, { kind: "saved", version, doc: "ab" }).model.base).toBe("ab");
  });

  test("our own write seen by the watch before the save returns isn't a conflict", () => {
    const saving = step(dirty(loaded(disk("a"))), { kind: "save-started", text: "ab" }).model;
    const next = step(saving, { kind: "disk", disk: disk("ab", 2), doc: "abc", by: null });

    expect(next.model.conflict).toBeNull();
    expect(next.effect).toBeNull();
  });

  test("a rejected save becomes the conflict; a failed one keeps the reason", () => {
    const saving = step(dirty(loaded(disk("a"))), { kind: "save-started", text: "ab" }).model;

    expect(
      step(saving, { kind: "save-rejected", current: disk("z", 3), by: "Codex" }).model.conflict?.by
    ).toBe("Codex");
    expect(step(saving, { kind: "save-failed", message: "EACCES" }).model.error).toBe("EACCES");
  });

  test("nothing to save, or a save in flight, doesn't save", () => {
    expect(canSave(loaded(disk("a")))).toBe(false);
    expect(canSave(step(dirty(loaded(disk("a"))), { kind: "save-started", text: "x" }).model)).toBe(
      false
    );
  });
});
