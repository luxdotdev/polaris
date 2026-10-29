import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SessionId, Subagent, SubagentId, TurnId } from "@polaris/protocol";
import { EntryView } from "./entries.tsx";

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const command = (id: string, line: string) => ({
  kind: "command" as const,
  id,
  live: false,
  command: line,
  output: `${line} output`,
  exitCode: 0,
  status: "completed" as const,
});

test("a tool run starts folded, lists its commands folded, and each opens on its own", () => {
  const { getByRole, queryByText } = render(
    <EntryView
      entry={{
        kind: "run",
        id: "run-folds",
        items: [command("c1", "git status"), command("c2", "bun test")],
        summary: "Ran 2 commands",
      }}
      ctx={{ hue: "claude", onOpenDiff: () => {} }}
    />
  );

  const run = getByRole("button", { name: /Ran 2 commands/ });
  expect(run.getAttribute("aria-expanded")).toBe("false");
  expect(queryByText("$ git status")).toBeNull();

  fireEvent.click(run);
  expect(run.getAttribute("aria-expanded")).toBe("true");
  expect(queryByText("$ git status")).not.toBeNull();
  expect(queryByText("git status output")).toBeNull();

  fireEvent.click(getByRole("button", { name: /\$ git status/ }));
  expect(queryByText("git status output")).not.toBeNull();
  expect(queryByText("bun test output")).toBeNull();
});

test("a working Subagent's hover fill covers its activity line, not only the header row", () => {
  const subagent = new Subagent({
    id: SubagentId.make("toolu_agent"),
    sessionId: SessionId.make("s1"),
    turnId: TurnId.make("t1"),
    parentItemId: "toolu_agent",
    title: "Find the subagent card",
    agent: "general-purpose",
    model: null,
    status: "working",
    startedAt: "2026-10-01T00:00:00.000Z",
    endedAt: null,
  });

  const { getByRole, getByTestId } = render(
    <EntryView
      entry={{
        kind: "subagent",
        card: {
          id: "toolu_agent",
          subagent,
          task: null,
          entries: [],
          report: null,
          activity: "Running cd apps",
        },
      }}
      ctx={{ hue: "claude", onOpenDiff: () => {} }}
    />
  );

  const header = getByRole("button", { name: /general-purpose/ });
  const filled = getByTestId("subagent-activity").closest("[class*='hover:bg-']");

  expect(filled?.contains(header)).toBe(true);
  expect(header.className).not.toMatch(/hover:bg-/);
});
