import "../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { type FakeBridge, installFakeBridge } from "../../test/bridge.testing.ts";
import { noiseKey, phone, route } from "../devices/fixture.testing.ts";
import { RelayRoute } from "./RelayRoute.tsx";

let fake: FakeBridge;

beforeEach(() => {
  fake = installFakeBridge();
});

afterEach(cleanup);

/** happy-dom lacks `oninput`, so React watches the focused field's value on key events. */
const type = (field: HTMLElement, value: string) => {
  act(() => field.focus());
  fireEvent.change(field, { target: { value } });
  fireEvent.keyUp(field, { key: "a" });
};

const row = () => within(render(<RelayRoute hostKey="studio" hostLabel="Mac Studio" />).container);

test("off with no relay, the switch waits for a URL, then turns the route on with it", async () => {
  const off = await route("off");
  fake.answerOk("relayRoute.status", off);
  fake.answerOk("devices.list", []);
  fake.answer("relayRoute.enable", ({ url }) => ({
    ok: true,
    value: { ...off, state: "on", url, connected: true },
  }));
  const view = row();

  await view.findByText("Add a relay to turn it on");
  const toggle = view.getByRole("switch", { name: "Polaris Relay" });
  expect(toggle).toHaveProperty("disabled", true);

  type(view.getByLabelText("Relay URL"), " wss://relay.lucas.dev/v1 ");
  fireEvent.click(toggle);

  await view.findByText("Connected · 0 devices");
  expect(fake.sent("relayRoute.enable")).toEqual([
    { hostKey: "studio", url: "wss://relay.lucas.dev/v1" },
  ]);
});

test("on, it counts the devices still linked and turns off at once", async () => {
  fake.answerOk("relayRoute.status", await route("on"));
  fake.answerOk("devices.list", [
    await phone({ noiseKey: noiseKey() }),
    await phone({ noiseKey: noiseKey(), unlinkedAt: "2026-10-22T00:00:00.000Z" }),
  ]);
  fake.answerOk("relayRoute.disable", await route("off"));
  const view = row();

  await view.findByText("Connected · 1 device");
  fireEvent.click(view.getByRole("switch", { name: "Polaris Relay" }));

  await waitFor(() =>
    expect(view.getByRole("switch", { name: "Polaris Relay" }).getAttribute("aria-checked")).toBe(
      "false"
    )
  );
  expect(fake.sent("relayRoute.disable")).toEqual([{ hostKey: "studio" }]);
});
