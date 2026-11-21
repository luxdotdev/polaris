import "../../../../test/dom.testing.ts";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { useRef } from "react";
import { useFocusOnShow } from "./LogbookTab.tsx";

afterEach(cleanup);

/** The tab bar's button, the tab's body, and a field elsewhere (the lead's composer). */
const Harness = ({ shown }: { readonly shown: string | null }) => {
  const ref = useRef<HTMLElement>(null);

  useFocusOnShow(ref, shown);

  return (
    <>
      <button type="button">Logbook</button>
      <textarea aria-label="Message the lead" />
      <section ref={ref} tabIndex={-1} aria-label="logbook body" />
    </>
  );
};

const body = (root: HTMLElement) => root.querySelector("section");

test("opening the tab from its button moves focus into its body", () => {
  const tabButton = document.createElement("button");

  document.body.append(tabButton);
  tabButton.focus();
  const { container } = render(<Harness shown="B1" />);

  expect(document.activeElement).toBe(body(container));
  tabButton.remove();
});

test("going back to the feed (Esc) keeps focus in the body for its keys", () => {
  const { container, rerender, getByRole } = render(<Harness shown="B1" />);

  act(() => getByRole("button").focus());
  rerender(<Harness shown={null} />);

  expect(document.activeElement).toBe(body(container));
});

test("focus is never taken from a field the user is typing in elsewhere", () => {
  const { rerender, getByLabelText } = render(<Harness shown="B1" />);
  const field = getByLabelText("Message the lead");

  act(() => field.focus());
  rerender(<Harness shown="B2" />);

  expect(document.activeElement).toBe(field);
});
