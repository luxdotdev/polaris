import "../../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { createRef } from "react";
import { Composer } from "./Composer.tsx";

afterEach(cleanup);

/** A note command the test settles by hand. */
const slowDaemon = () => {
  const sent: Array<string> = [];
  let settle: (ok: boolean) => void = () => undefined;

  const onNote = (text: string) => {
    sent.push(text);

    return new Promise<boolean>((resolve) => {
      settle = resolve;
    });
  };

  return { sent, onNote, settle: (ok: boolean) => settle(ok) };
};

const mount = (onNote: (text: string) => Promise<boolean>) => {
  render(<Composer taskId="B1" inputRef={createRef()} onNote={onNote} onMessage={null} />);

  const field = screen.getByLabelText("Note on B1");

  if (!(field instanceof HTMLTextAreaElement)) throw new Error("the note field is a textarea");

  return field;
};

const submit = (field: HTMLTextAreaElement) =>
  fireEvent.keyDown(field, { key: "Enter", metaKey: true });

test("a sent note clears the field once the Daemon takes it", async () => {
  const daemon = slowDaemon();
  const field = mount(daemon.onNote);

  fireEvent.change(field, { target: { value: "Check the Pi trace" } });
  submit(field);
  await act(async () => daemon.settle(true));

  expect(daemon.sent).toEqual(["Check the Pi trace"]);
  expect(field.value).toBe("");
});

test("what was typed while a note was sending is kept", async () => {
  const daemon = slowDaemon();
  const field = mount(daemon.onNote);

  fireEvent.change(field, { target: { value: "First note" } });
  submit(field);
  fireEvent.change(field, { target: { value: "First note, and a second thought" } });
  await act(async () => daemon.settle(true));

  expect(daemon.sent).toEqual(["First note"]);
  expect(field.value).toBe("First note, and a second thought");
});

test("a refused note stays in the field", async () => {
  const daemon = slowDaemon();
  const field = mount(daemon.onNote);

  fireEvent.change(field, { target: { value: "Refused" } });
  submit(field);
  await act(async () => daemon.settle(false));

  expect(field.value).toBe("Refused");
});
