import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { CopyProvider, type CopyWrite } from "../../lib/copy";
import { TooltipProvider } from "../ui/tooltip";
import { CopyButton } from "./copy-button";

beforeEach(() => jest.useFakeTimers());

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/** Lets the writer's promise settle inside act. */
const settle = () => act(async () => await Promise.resolve());

const setup = (write: CopyWrite, text: string | (() => string) = "brew install shellcheck") => {
  const view = render(
    <CopyProvider write={write}>
      <TooltipProvider>
        <CopyButton text={text} />
      </TooltipProvider>
    </CopyProvider>
  );

  const button = view.getByRole("button", { name: "Copy" });

  return { ...view, button, state: () => button.getAttribute("data-copy-state") };
};

const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));

describe("CopyButton", () => {
  test("copies, says Copied, and is idle again after 1.5s", async () => {
    const written: string[] = [];

    const { button, state, getByRole } = setup(async (text) => {
      written.push(text);

      return true;
    });

    fireEvent.click(button);
    await settle();
    expect(written).toEqual(["brew install shellcheck"]);
    expect(state()).toBe("copied");
    expect(getByRole("status").textContent).toBe("Copied");
    await advance(1499);
    expect(state()).toBe("copied");
    await advance(1);
    expect(state()).toBe("idle");
    expect(getByRole("status").textContent).toBe("");
  });

  test("a refused or failing write says Couldn't copy", async () => {
    const refused = setup(async () => false);

    fireEvent.click(refused.button);
    await settle();
    expect(refused.state()).toBe("failed");
    expect(refused.getByRole("status").textContent).toBe("Couldn't copy");
    cleanup();

    const thrown = setup(() => Promise.reject(new Error("denied")));

    fireEvent.click(thrown.button);
    await settle();
    expect(thrown.state()).toBe("failed");
  });

  test("repeated clicks restart the wait instead of stacking timers", async () => {
    const { button, state } = setup(async () => true);

    for (let click = 0; click < 5; click++) {
      fireEvent.click(button);
      await settle();
      await advance(1000);
      expect(state()).toBe("copied");
    }

    await advance(499);
    expect(state()).toBe("copied");
    await advance(1);
    expect(state()).toBe("idle");
  });

  test("a lazy text is read at click time", async () => {
    const written: string[] = [];
    let shown = "first";

    const { button } = setup(
      async (text) => {
        written.push(text);

        return true;
      },
      () => shown
    );

    shown = "second";
    fireEvent.click(button);
    await settle();
    expect(written).toEqual(["second"]);
  });

  test("unmounting clears the timer and drops a late answer", async () => {
    const shown = setup(async () => true);
    const before = jest.getTimerCount();

    fireEvent.click(shown.button);
    await settle();
    expect(jest.getTimerCount()).toBe(before + 1);
    shown.unmount();
    expect(jest.getTimerCount()).toBe(before);

    let resolve: (ok: boolean) => void = () => undefined;

    const late = setup(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        })
    );

    const timers = jest.spyOn(globalThis, "setTimeout");

    fireEvent.click(late.button);
    late.unmount();
    resolve(true);
    await settle();
    // No 1.5s reset is scheduled for a button that is gone.
    expect(timers.mock.calls.filter(([, ms]) => ms === 1500)).toHaveLength(0);
    timers.mockRestore();
  });

  test("every face shares one cell, so the width holds; only one face shows", async () => {
    const { button } = setup(async () => true);
    const faces = () => [...button.querySelectorAll("[data-face]")];

    expect(faces().map((face) => face.textContent)).toEqual(["Copy", "Copied", "Couldn't copy"]);
    expect(faces().every((face) => face.className.includes("col-start-1 row-start-1"))).toBe(true);
    expect(faces().map((face) => face.getAttribute("data-shown"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    fireEvent.click(button);
    await settle();
    expect(faces().map((face) => face.getAttribute("data-shown"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });
});
