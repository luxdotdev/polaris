import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, mock, test } from "bun:test";

import { HarnessChoice } from "./harness-choice";
import { HostStateCard, HostStateChip } from "./host-state";
import { MachineBar } from "./machine-bar";
import { NeedsYouCard, QuestionCard, WaitingCard } from "./needs-you";
import { SetupRow } from "./onboarding";

afterEach(cleanup);

describe("HostStateChip", () => {
  test("says the Connection State in words", () => {
    const cases = [
      ["connected", undefined, "Mac Studio"],
      ["reconnecting", "12s", "Linux VM · reconnecting 12s"],
      ["offline", "09:14", "MacBook Pro · offline since 09:14"],
    ] as const;

    for (const [state, since, text] of cases) {
      const host = text.split(" · ")[0] ?? "";
      const { container } = render(<HostStateChip host={host} state={state} since={since} />);

      expect(container.textContent).toBe(text);
      cleanup();
    }
  });

  test("needs attention is a button that opens the inline card, never a dialog", () => {
    const onOpen = mock(() => undefined);

    const { getByRole, queryByRole } = render(
      <HostStateChip host="Raspberry Pi 4" state="needs-attention" onOpen={onOpen} />
    );

    fireEvent.click(getByRole("button", { name: /Raspberry Pi 4 Needs attention/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(queryByRole("dialog")).toBeNull();
  });
});

describe("HostStateCard", () => {
  test("has at most one primary fix", () => {
    const { container } = render(
      <HostStateCard
        reason="host-key-unknown"
        title="Linux VM's host key isn't trusted yet"
        body="Connect once in a terminal."
        detail="ssh linux-vm"
        fix={{ label: "Open in terminal", onAction: () => undefined }}
        secondary={{ label: "Retry", onAction: () => undefined }}
      />
    );

    expect(container.querySelectorAll("[data-variant=primary]").length).toBe(1);
    expect(container.querySelector("[data-slot=code-well]")?.textContent).toBe("ssh linux-vm");
  });

  test("a changed host key can go without a fix", () => {
    const { container } = render(
      <HostStateCard
        reason="host-key-changed"
        title="Linux VM's host key changed"
        body="If you didn't rebuild it, don't connect."
        secondary={{ label: "Copy command", onAction: () => undefined }}
      />
    );

    expect(container.querySelector("[data-variant=primary]")).toBeNull();
  });

  test("shows install progress as a progressbar", () => {
    const { getByRole } = render(
      <HostStateCard
        reason="installing"
        title="Installing on Linux VM"
        body="Copying the build."
        progress={{ value: 0.57, label: "3 of 4 files" }}
      />
    );

    expect(getByRole("progressbar").getAttribute("aria-valuenow")).toBe("57");
  });
});

describe("HarnessChoice", () => {
  test("is a radio group with one checked card", () => {
    const onValueChange = mock((_value: string) => undefined);

    const { getAllByRole } = render(
      <HarnessChoice
        aria-label="Harness"
        value="claude"
        onValueChange={onValueChange}
        options={[
          { value: "claude", hue: "claude", icon: null, title: "Claude Code", caption: "Opus 5" },
          { value: "codex", hue: "codex", icon: null, title: "Codex", caption: "GPT-5.4" },
        ]}
      />
    );

    const radios = getAllByRole("radio");

    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    const [, codex] = radios;

    if (codex === undefined) throw new Error("no Codex card");
    fireEvent.click(codex);
    expect(onValueChange).toHaveBeenCalledWith("codex");
  });
});

describe("Needs You", () => {
  test("an approval card offers Approve, Always here and Deny", () => {
    const { getAllByRole } = render(
      <NeedsYouCard
        harness="codex"
        title="Spike GPUI review screen"
        where="Mac Studio · polaris · 42m"
        approval={{ command: "cargo build --release" }}
      />
    );

    expect(getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Approve",
      "Always here",
      "Deny",
    ]);
  });

  test("a waiting card has exactly one action", () => {
    const { getAllByRole } = render(
      <WaitingCard
        kind="failed"
        icon={null}
        title="Home automation cron"
        detail="Failed · out of memory"
        action={{ label: "Retry", onAction: () => undefined }}
      />
    );

    expect(getAllByRole("button").length).toBe(1);
  });

  test("a question numbers its answers and fills only the recommended one", () => {
    const onAnswer = mock((_index: number) => undefined);

    const { getAllByRole, container } = render(
      <QuestionCard
        harness="claude"
        question="Monthly or annually?"
        answers={[{ label: "Annual", recommended: true }, { label: "Monthly" }]}
        onAnswer={onAnswer}
      />
    );

    const answers = getAllByRole("button");

    expect(container.textContent).toContain("Claude Code needs an answer");
    expect(answers[0]?.textContent).toBe("1AnnualRecommended");
    expect(answers[0]?.className).toContain("bg-primary");
    expect(answers[1]?.className).not.toContain("bg-primary");
    const [, monthly] = answers;

    if (monthly === undefined) throw new Error("no second answer");
    fireEvent.click(monthly);
    expect(onAnswer).toHaveBeenCalledWith(1);
  });
});

describe("MachineBar", () => {
  test("marks the selected machine and adds machines", () => {
    const onSelect = mock((_id: string) => undefined);
    const onAdd = mock(() => undefined);

    const { getByRole } = render(
      <MachineBar
        selected="vm"
        onSelect={onSelect}
        onAdd={onAdd}
        machines={[
          { id: "mbp", name: "MacBook Pro", detail: "3 workspaces" },
          { id: "vm", name: "Linux VM", needsYou: 1 },
        ]}
      />
    );

    expect(getByRole("button", { name: /Linux VM/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(getByRole("button", { name: /MacBook Pro/ }));
    expect(onSelect).toHaveBeenCalledWith("mbp");
    fireEvent.click(getByRole("button", { name: /Add machine/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe("SetupRow", () => {
  test("a locked row says why instead of offering its action", () => {
    const { container } = render(
      <SetupRow
        icon={null}
        title="Start a session"
        caption="Ready"
        action={<button type="button" />}
        locked="Needs a workspace"
      />
    );

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Needs a workspace");
  });
});
