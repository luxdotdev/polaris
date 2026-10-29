import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { TurnItem } from "@polaris/protocol";
import { standInBridge } from "../../bridge.ts";
import { completedItemView } from "../model/items.ts";
import type { ToolInput, ToolOutput } from "../model/toolCalls/index.ts";
import { groupItems } from "../model/runs.ts";
import { EntryView } from "./entries.tsx";

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(() => {
  cleanup();
  standInBridge(null);
});

const I = TurnItem.cases;

const web = (
  id: string,
  name: "WebSearch" | "WebFetch",
  input: ToolInput,
  output: ToolOutput = null
) =>
  completedItemView(
    I.ToolCall.make({
      id,
      name,
      kind: name === "WebSearch" ? "web-search" : "fetch",
      input,
      output,
      status: "completed",
    })
  );

const search = web(
  "s1",
  "WebSearch",
  { query: "bun terminal api" },
  {
    query: "bun terminal api",
    results: [
      "Here are the results",
      {
        tool_use_id: "srv_1",
        content: [{ title: "Bun.Terminal docs", url: "https://bun.sh/docs/api/terminal" }],
      },
    ],
    durationSeconds: 1,
  }
);

const fetches = [
  web("f1", "WebFetch", { url: "https://www.effect.website/docs/schema", prompt: "read" }),
  web("f2", "WebFetch", { url: "https://github.com/oven-sh/bun/issues/1", prompt: "read" }),
];

const message = completedItemView(I.AssistantMessage.make({ id: "m1", text: "Done." }));

test("a Turn's search and fetches gather into one pill where the first was", () => {
  const entries = groupItems([search, message, ...fetches]);

  expect(entries.map((e) => e.kind)).toEqual(["sources", "item"]);
});

test("the pill counts the sources and opens to each one; a link opens in the browser", () => {
  const opened: Array<unknown> = [];

  standInBridge({
    request: (method, input) => {
      opened.push([method, input]);

      // SAFETY: shell.openExternal is the only method the pill calls; its answer is unread.
      return Promise.resolve({ ok: true, value: null }) as never;
    },
    subscribe: () => () => undefined,
    onAppEvent: () => () => undefined,
  });

  const [entry] = groupItems([search, ...fetches]);

  if (entry === undefined) throw new Error("no entry");

  const { getByTestId } = render(
    <EntryView entry={entry} ctx={{ hue: "claude", onOpenDiff: () => {} }} />
  );

  const pill = getByTestId("sources-pill");

  expect(pill.textContent).toBe("3 sources");
  fireEvent.click(pill);

  const popover = within(document.body).getByTestId("sources-popover");
  const text = popover.textContent ?? "";

  for (const shown of [
    "Searched bun terminal api",
    "Bun.Terminal docs",
    "bun.sh · https://bun.sh/docs/api/terminal",
    "effect.website · https://www.effect.website/docs/schema",
    "github.com · https://github.com/oven-sh/bun/issues/1",
  ])
    expect(text).toContain(shown);

  fireEvent.click(within(popover).getByText("Bun.Terminal docs"));
  expect(opened).toEqual([["shell.openExternal", { url: "https://bun.sh/docs/api/terminal" }]]);
});
