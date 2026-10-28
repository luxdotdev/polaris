import "../../../test/dom.testing.ts";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { type ReactElement, useState } from "react";
import type { FrecencyTable } from "../model/frecency.ts";
import PromptEditor from "./PromptEditor.tsx";

const EMPTY_TABLE: FrecencyTable = {};

/** A session screen: the composer, plus the other things that can hold focus there. */
const Screen = ({ draft = "", disabled = false }: { draft?: string; disabled?: boolean }) => {
  const [value, setValue] = useState(draft);

  return (
    <div>
      <button type="button" data-testid="body-button">
        Copy
      </button>
      <input data-testid="search" />
      <div className="xterm" data-testid="terminal">
        <textarea data-testid="terminal-input" />
      </div>
      <PromptEditor
        value={value}
        onChange={setValue}
        placeholder="Message"
        disabled={disabled}
        autoFocus={false}
        typeToFocus
        options={[]}
        loading={false}
        onSubmit={() => undefined}
        onEscape={() => false}
        takesFiles={false}
        onAction={() => undefined}
        menuSlot={null}
        notice={null}
        frecency={EMPTY_TABLE}
        onPicked={() => undefined}
      />
    </div>
  );
};

/** Renders, then lets Lexical's first update settle. */
const mount = async (screen: ReactElement) => {
  render(screen);
  await act(async () => undefined);
};

const composer = () => document.querySelector<HTMLElement>('[data-testid="composer-input"]');

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** A keydown as the browser sends it, at whatever has focus (the body when nothing does). */
const press = (key: string, init: KeyboardEventInit = {}) => {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });

  act(() => {
    target.dispatchEvent(event);
  });

  return event;
};

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("type-to-focus", () => {
  test("a letter typed with focus on the body lands in the composer once", async () => {
    await mount(<Screen />);
    expect(document.activeElement).toBe(document.body);

    const event = press("h");

    expect(document.activeElement).toBe(composer());
    expect(composer()?.textContent).toBe("h");
    // Cancelled, so the browser doesn't type it a second time.
    expect(event.defaultPrevented).toBe(true);
  });

  test("from a non-text button too, after the existing draft", async () => {
    await mount(<Screen draft="fix the " />);
    byTestId("body-button")?.focus();

    press("T", { shiftKey: true });

    expect(document.activeElement).toBe(composer());
    expect(composer()?.textContent).toBe("fix the T");
  });

  test.each([
    ["a text field", () => byTestId("search")?.focus()],
    ["a terminal", () => byTestId("terminal-input")?.focus()],
  ])("never takes a key typed in %s", async (_, focus) => {
    await mount(<Screen />);
    focus();
    const focused = document.activeElement;

    const event = press("h");

    expect(document.activeElement).toBe(focused);
    expect(composer()?.textContent).toBe("");
    expect(event.defaultPrevented).toBe(false);
  });

  test("never takes a key while a dialog is open", async () => {
    await mount(<Screen />);
    const dialog = document.createElement("div");

    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);

    press("h");

    expect(composer()?.textContent).toBe("");
    expect(document.activeElement).not.toBe(composer());
  });

  test.each([
    ["⌘", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["⌥", { altKey: true }],
  ])("ignores a key with %s held", async (_, modifiers) => {
    await mount(<Screen />);

    press("h", modifiers);

    expect(composer()?.textContent).toBe("");
    expect(document.activeElement).not.toBe(composer());
  });

  test.each([
    ["ArrowDown", "ArrowDown"],
    ["Tab", "Tab"],
    ["Enter", "Enter"],
    ["Escape", "Escape"],
    ["PageDown", "PageDown"],
    ["F5", "F5"],
    ["Space", " "],
  ])("leaves %s to the page", async (_, key) => {
    await mount(<Screen />);

    press(key);

    expect(document.activeElement).not.toBe(composer());
  });

  test("a shortcut that took the key keeps it", async () => {
    await mount(<Screen />);
    const taken = (event: KeyboardEvent) => event.preventDefault();

    // The shell's keys listen first (bare K opens Jump to…).
    window.addEventListener("keydown", taken, { capture: true });

    try {
      press("k");
    } finally {
      window.removeEventListener("keydown", taken, { capture: true });
    }

    expect(composer()?.textContent).toBe("");
  });

  test("a dead key or IME start only moves focus, for the browser to deliver", async () => {
    await mount(<Screen draft="caf" />);

    const event = press("Dead");

    expect(document.activeElement).toBe(composer());
    expect(composer()?.textContent).toBe("caf");
    expect(event.defaultPrevented).toBe(false);
  });

  test("not into a disabled composer", async () => {
    await mount(<Screen disabled />);

    press("h");

    expect(composer()?.textContent).toBe("");
    expect(document.activeElement).not.toBe(composer());
  });
});
