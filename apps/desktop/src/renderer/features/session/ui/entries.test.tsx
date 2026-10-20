import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
