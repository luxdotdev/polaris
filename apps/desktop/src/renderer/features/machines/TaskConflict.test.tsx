import "../../test/dom.testing.ts";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MachineView } from "../../../shared/api.ts";
import { installFakeBridge, type FakeBridge } from "../../test/bridge.testing.ts";
import { TaskConflictCard } from "./Attention.tsx";
import { attentionCard } from "./model.ts";

let fake: FakeBridge;

beforeEach(() => {
  fake = installFakeBridge();
});

afterEach(() => cleanup());

const OTHER_HOME = "C:\\Users\\lucas\\polaris-dev\\.polaris";

/** A Windows Host whose install stopped on a sign-in task another Polaris home holds. */
const held = (otherHome: string | null = OTHER_HOME): MachineView => ({
  daemon: null,
  key: "pc",
  kind: "ssh",
  label: "Gaming PC",
  colour: null,
  alias: "pc",
  target: null,
  enabled: true,
  forwardAgent: false,
  remoteCommand: null,
  windowsShell: "powershell",
  status: null,
  install: {
    step: "blocked",
    activity: null,
    offer: null,
    outcome: null,
    problem: {
      kind: "task-conflict",
      message: "the scheduled task dev.lux.polaris.lucas runs another home",
      command: null,
      conflict: { task: "dev.lux.polaris.lucas", otherHome },
    },
  },
});

const show = (machine: MachineView) => {
  const model = attentionCard(machine);

  if (model === null) throw new Error("no card");

  const { container } = render(<TaskConflictCard machine={machine} model={model} />);

  return { text: () => container.textContent ?? "", ...within(container) };
};

describe("a sign-in task another Polaris home holds", () => {
  test("says which home holds the task, and asks nothing yet", () => {
    const card = show(held());

    expect(card.text()).toContain("Another Polaris home holds the sign-in task on Gaming PC.");
    expect(card.text()).toContain(`dev.lux.polaris.lucas\nruns ${OTHER_HOME}`);
    expect(card.queryByTestId("take-over-confirmation")).toBeNull();
    expect(fake.methods()).toEqual([]);
  });

  test("take over asks first, with the consequence; confirming sends the take-over once", () => {
    const card = show(held());

    fireEvent.click(card.getByRole("button", { name: "Take over sign-in task" }));
    const asking = card.getByTestId("take-over-confirmation");

    expect(asking.textContent).toContain(
      `If that home's daemon is running under the task, it stops now: its terminals end`
    );
    expect(asking.textContent).toContain(
      `${OTHER_HOME} stays installed but no longer starts on its own.`
    );
    expect(fake.methods()).toEqual([]);

    fireEvent.click(within(asking).getByRole("button", { name: "Take over sign-in task" }));
    expect(fake.sent("machines.takeOverTask")).toEqual([{ hostKey: "pc" }]);
  });

  test("cancel sends nothing and shows the card again", () => {
    const card = show(held());

    fireEvent.click(card.getByRole("button", { name: "Take over sign-in task" }));
    fireEvent.click(card.getByRole("button", { name: "Cancel" }));

    expect(card.queryByTestId("take-over-confirmation")).toBeNull();
    expect(card.getByRole("button", { name: "Take over sign-in task" })).not.toBeNull();
    expect(fake.methods()).toEqual([]);
  });

  test("a task that isn't Polaris' is named, and replacing it says what it does", () => {
    const card = show(held(null));

    expect(card.text()).toContain("Another program's task has the daemon's name on Gaming PC.");
    fireEvent.click(card.getByRole("button", { name: "Take over sign-in task" }));
    expect(card.getByTestId("take-over-confirmation").textContent).toContain(
      "Replace dev.lux.polaris.lucas on Gaming PC."
    );
  });
});
