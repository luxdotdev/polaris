import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Preview } from "../refactors/coordinator.ts";
import { doc, proposal } from "../refactors/testing.ts";
import { acceptKey, RenamePreviewCard, type RenamePreviewProps } from "./RenamePreview.tsx";

// Another DOM test file may have unregistered happy-dom already.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const dom = () => within(document.body);

const lines = (count: number, name: string) =>
  Array.from({ length: count }, (_, i) => `use(${name}); // ${i}`).join("\n\n");

const preview: Preview = {
  proposal: { ...proposal(), label: "Rename BASE_DELAY_MS to RETRY_DELAY_MS" },
  originals: [
    doc("/checkout/src/backoff.ts", lines(3, "BASE_DELAY_MS"), false),
    doc("/checkout/src/delay.ts", lines(2, "BASE_DELAY_MS"), false),
    doc("/checkout/src/retry.ts", lines(1, "BASE_DELAY_MS"), true),
  ],
  documents: [
    doc("/checkout/src/backoff.ts", lines(3, "RETRY_DELAY_MS"), true),
    doc("/checkout/src/delay.ts", lines(2, "RETRY_DELAY_MS"), true),
    doc("/checkout/src/retry.ts", lines(1, "RETRY_DELAY_MS"), true),
  ],
  touched: ["/checkout/src/backoff.ts", "/checkout/src/delay.ts", "/checkout/src/retry.ts"],
  fingerprint: "f",
};

const card = (patch: Partial<RenamePreviewProps> = {}) => {
  const calls: string[] = [];

  render(
    <RenamePreviewCard
      preview={preview}
      root="/checkout"
      first="/checkout/src/delay.ts"
      provider="TypeScript 7.0.2"
      host="Mac Studio"
      busy={false}
      failure={null}
      onAccept={() => calls.push("accept")}
      onCancel={() => calls.push("cancel")}
      {...patch}
    />
  );

  return calls;
};

describe("the rename preview card (Paper L7)", () => {
  test("names, counts, the starting file first and open, the others closed", () => {
    card();

    expect(dom().getByRole("heading").textContent).toBe("RenameBASE_DELAY_MStoRETRY_DELAY_MS");
    expect(dom().getByText("6 changes in 3 files · TypeScript 7.0.2 · Mac Studio")).toBeTruthy();

    const rows = dom().getAllByTestId("rename-file");

    expect(rows.map((row) => row.querySelector("button")?.textContent)).toEqual([
      "delay.tssrc2 changes",
      "backoff.tssrc3 changes",
      "retry.tssrc· unsaved edits kept1 change",
    ]);
    expect(rows.map((row) => row.querySelector("button")?.getAttribute("aria-expanded"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(rows[0]?.querySelectorAll('[data-kind="removed"]')).toHaveLength(2);
    expect(dom().getByText("Rename in 3 files")).toBeTruthy();
  });

  test("a file with more than two changes shows its first, then folds the rest until asked", () => {
    card();
    const backoff = dom().getAllByTestId("rename-file")[1]!;
    fireEvent.click(backoff.querySelector("button")!);

    expect(backoff.querySelectorAll('[data-kind="added"]')).toHaveLength(1);
    fireEvent.click(within(backoff).getByText("2 more changes, lines 3 and 5"));
    expect(backoff.querySelectorAll('[data-kind="added"]')).toHaveLength(3);
  });

  test("Cancel and Rename call their actions; ⌘↵ accepts", () => {
    const calls = card();
    fireEvent.click(dom().getByText("Cancel"));
    fireEvent.click(dom().getByText("Rename in 3 files"));

    const keyEvent = (key: string, metaKey: boolean) => ({
      key,
      metaKey,
      ctrlKey: false,
      preventDefault: () => undefined,
    });

    acceptKey(false, null, () => calls.push("key"))(keyEvent("Enter", true));
    acceptKey(false, null, () => calls.push("key"))(keyEvent("Enter", false));
    acceptKey(true, null, () => calls.push("key"))(keyEvent("Enter", true));
    expect(calls).toEqual(["cancel", "accept", "key"]);
  });

  test("a refusal reads as one line and Rename can't run again", () => {
    card({ failure: "A file changed since this preview, so nothing was renamed." });

    expect(dom().getByRole("alert").textContent).toContain("nothing was renamed");
    expect(dom().getByText("Rename in 3 files").closest("button")?.hasAttribute("disabled")).toBe(
      true
    );
  });
});
