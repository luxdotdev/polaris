import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import {
  acceptCard,
  cardField,
  cardHeight,
  cardOf,
  closeCard,
  lastLine,
  openCard,
  showProposal,
} from "./state.ts";

const base = () => EditorState.create({ doc: "one\ntwo\nthree\n", extensions: [cardField] });

const opened = () => base().update({ effects: openCard.of({ from: 4, to: 7 }) }).state;

const proposal = [{ from: 4, to: 7, text: "TWO" }];

describe("cardField", () => {
  test("opens on a range, with no proposal", () => {
    expect(cardOf(opened())).toMatchObject({ from: 4, to: 7, version: 0, proposal: null });
  });

  test("an edit above maps the range and bumps the version", () => {
    const state = opened().update({ changes: { from: 0, insert: "zero\n" } }).state;

    expect(cardOf(state)).toMatchObject({ from: 9, to: 12, version: 1 });
  });

  test("a proposal shows only for the version it was made at", () => {
    const state = opened();

    const shown = state.update({
      effects: showProposal.of({ version: 0, replacements: proposal }),
    }).state;

    const late = state.update({
      effects: showProposal.of({ version: 3, replacements: proposal }),
    }).state;

    expect(cardOf(shown)?.proposal).toEqual(proposal);
    expect(cardOf(late)?.proposal).toBeNull();
  });

  test("any edit while a proposal shows drops it", () => {
    const shown = opened().update({
      effects: showProposal.of({ version: 0, replacements: proposal }),
    }).state;

    const edited = shown.update({ changes: { from: 0, insert: "x" } }).state;

    expect(cardOf(edited)?.proposal).toBeNull();
  });

  test("accepting applies the edit and closes; closing leaves the text", () => {
    const shown = opened().update({
      effects: showProposal.of({ version: 0, replacements: proposal }),
    }).state;

    const accepted = shown.update({
      changes: { from: 4, to: 7, insert: "TWO" },
      effects: acceptCard.of(null),
    }).state;

    expect(cardOf(accepted)).toBeNull();
    expect(accepted.doc.toString()).toBe("one\nTWO\nthree\n");
    expect(cardOf(shown.update({ effects: closeCard.of(null) }).state)).toBeNull();
  });

  test("a new height keeps the card and its proposal", () => {
    const shown = opened().update({
      effects: showProposal.of({ version: 0, replacements: proposal }),
    }).state;

    const taller = shown.update({ effects: cardHeight.of(96) }).state;

    expect(cardOf(taller)).toMatchObject({ height: 96, proposal, version: 0 });
  });
});

describe("lastLine", () => {
  const doc = base().doc;

  test("a range ending at column 1 stops at the line above", () => {
    expect(lastLine(doc, 0, 8)).toBe(2);
    expect(lastLine(doc, 0, 9)).toBe(3);
  });

  test("an empty range at a line's start is that line", () => {
    expect(lastLine(doc, 4, 4)).toBe(2);
  });
});
