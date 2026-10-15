import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { HostView } from "../../../../shared/api.ts";
import {
  DEFAULT_PREDICTION_PREFERENCES,
  predictionPreferenceView,
} from "../../../../shared/predictionPlacement.ts";
import { installFakeBridge, type FakeBridge } from "../../../test/bridge.testing.ts";
import { HOSTS } from "../../needs-you/preview/fixtures.ts";
import { predictionStore } from "../../editor/prediction/store.ts";
import { ClearHistoryRow, EditPredictionRows } from "./EditPredictionRows.tsx";

const host = (key: string, kind: HostView["kind"]): HostView => {
  const base = HOSTS[0];

  if (base === undefined) throw new Error("needs-you fixtures have no Host");

  return { ...base, key, kind, label: key, alias: kind === "local" ? null : key };
};

const hosts = [host("local", "local"), host("studio", "ssh")];

let fake: FakeBridge;

beforeEach(() => {
  fake = installFakeBridge();
  fake.answer("prediction.settings.set", (input) => ({
    ok: true,
    value: predictionPreferenceView(input.preferences),
  }));
  fake.answerOk("prediction.enabled.set", { enabled: true, configured: true });
  predictionStore.setState({
    loaded: true,
    enabled: true,
    preferences: {
      local: { ...DEFAULT_PREDICTION_PREFERENCES, disabledLanguages: ["python", "yaml"] },
    },
  });
});

afterEach(() => {
  cleanup();
  predictionStore.setState({ preferences: {}, loaded: false });
});

test("Display and Aggressiveness are written to every Host, so each editor reads the same", async () => {
  const errors: Array<string | null> = [];
  const page = render(<EditPredictionRows hosts={hosts} onError={(m) => errors.push(m)} />);

  await act(async () => fireEvent.click(page.getByRole("radio", { name: "Subtle" })));
  await waitFor(() => expect(fake.sent("prediction.settings.set")).toHaveLength(2));
  expect(fake.sent("prediction.settings.set").map((input) => input.hostKey)).toEqual([
    "local",
    "studio",
  ]);
  expect(fake.sent("prediction.settings.set")[1]?.preferences.display).toBe("subtle");
  expect(page.getByRole("radio", { name: "Subtle" }).getAttribute("aria-checked")).toBe("true");

  await act(async () => fireEvent.click(page.getByRole("radio", { name: "Eager" })));
  await waitFor(() => expect(fake.sent("prediction.settings.set")).toHaveLength(4));
  expect(fake.sent("prediction.settings.set")[3]?.preferences).toMatchObject({
    display: "subtle",
    aggressiveness: "eager",
  });
  expect(errors).toEqual([null, null]);
});

test("A language's chip turns completion back on for it and leaves the others off", async () => {
  const page = render(<EditPredictionRows hosts={hosts} onError={() => undefined} />);
  const list = page.getByRole("list", { name: "Languages with tab completion off" });
  expect(list.textContent).toContain("Python");
  expect(list.textContent).toContain("YAML");

  await act(async () =>
    fireEvent.click(page.getByRole("button", { name: "Turn tab completion back on for Python" }))
  );
  await waitFor(() => expect(fake.sent("prediction.settings.set")).toHaveLength(2));
  expect(fake.sent("prediction.settings.set")[0]?.preferences.disabledLanguages).toEqual(["yaml"]);
  await waitFor(() => expect(list.textContent).not.toContain("Python"));
});

test("The accept key shows the binding's key and says remapping isn't here yet", () => {
  const page = render(<EditPredictionRows hosts={hosts} onError={() => undefined} />);
  expect(page.getByText("Tab")).toBeTruthy();
  expect(page.getByText(/Tab by default/).textContent).toContain("Keyboard");
});

test("Clear history asks main to erase the outcome log and says so once it has", async () => {
  const page = render(<ClearHistoryRow />);
  await act(async () => fireEvent.click(page.getByRole("button", { name: "Clear history" })));
  await waitFor(() => expect(fake.methods()).toContain("prediction.outcomes.clear"));
  await waitFor(() => expect(page.getByRole("status").textContent).toBe("Cleared"));

  fake.refuse("prediction.outcomes.clear", { code: "Unavailable", message: "no log" });
  await act(async () => fireEvent.click(page.getByRole("button", { name: "Clear history" })));
  await waitFor(() => expect(page.getByRole("alert").textContent).toBe("Couldn't clear it"));
});
