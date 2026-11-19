import "../../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { CopyProvider, TooltipProvider } from "@polaris/ui";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, test } from "bun:test";
import Streamed from "./Streamed.tsx";

// Another DOM test file may have unregistered happy-dom already.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const MARKDOWN = [
  "Use `inline` code.",
  "",
  "```ts",
  "const a = 1;",
  "const b = `two`;",
  "```",
  "",
  "| Host | Latency |",
  "| --- | --- |",
  "| Mac Studio | 12ms |",
  "",
].join("\n");

const show = () => {
  const written: string[] = [];

  const view = render(
    <CopyProvider
      write={async (text) => {
        written.push(text);

        return true;
      }}
    >
      <TooltipProvider>
        <Streamed text={MARKDOWN} live={false} />
      </TooltipProvider>
    </CopyProvider>
  );

  return { ...view, written };
};

test("a fence copies its code exactly, and inline code gets no button", async () => {
  const { getByRole, getAllByRole, written } = show();
  const copy = getByRole("button", { name: "Copy code" });

  expect(getAllByRole("button", { name: "Copy code" })).toHaveLength(1);
  fireEvent.click(copy);
  await waitFor(() => expect(copy.getAttribute("data-copy-state")).toBe("copied"));
  expect(written).toEqual(["const a = 1;\nconst b = `two`;"]);
});

test("a table copies as Markdown", async () => {
  const { getByRole, written } = show();
  const copy = getByRole("button", { name: "Copy table" });

  fireEvent.click(copy);
  await waitFor(() => expect(copy.getAttribute("data-copy-state")).toBe("copied"));
  expect(written[0]).toContain("| Host | Latency |");
  expect(written[0]).toContain("| Mac Studio | 12ms |");
});

test("a table's Markdown escapes pipes in its cells", async () => {
  const written: string[] = [];

  const { getByRole } = render(
    <CopyProvider
      write={async (text) => {
        written.push(text);

        return true;
      }}
    >
      <TooltipProvider>
        <Streamed text={"| a | b |\n| --- | --- |\n| x \\| y | z |\n"} live={false} />
      </TooltipProvider>
    </CopyProvider>
  );

  const copy = getByRole("button", { name: "Copy table" });

  fireEvent.click(copy);
  await waitFor(() => expect(copy.getAttribute("data-copy-state")).toBe("copied"));
  expect(written[0]).toBe("| a | b |\n| --- | --- |\n| x \\| y | z |");
});
