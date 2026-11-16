import "../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { type FakeBridge, installFakeBridge } from "../../test/bridge.testing.ts";
import { noiseKey, phone, route } from "../devices/fixture.testing.ts";
import { RelayRoute, relayAddress } from "./RelayRoute.tsx";

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

const answerEnable = (off: Awaited<ReturnType<typeof route>>) =>
  fake.answer("relayRoute.enable", ({ url }) => ({
    ok: true,
    value: { ...off, state: "on", url, connected: true },
  }));

test("off with no relay, the switch turns the route on with Polaris Cloud's relay", async () => {
  const off = await route("off");
  fake.answerOk("relayRoute.status", off);
  fake.answerOk("devices.list", []);
  answerEnable(off);
  const view = row();

  await view.findByText("Off · Polaris Cloud");
  expect(view.queryByLabelText("Relay URL")).toBeNull();
  fireEvent.click(view.getByRole("switch", { name: "Polaris Relay" }));

  await view.findByText("Connected · 0 devices · Polaris Cloud");
  expect(fake.sent("relayRoute.enable")).toEqual([
    { hostKey: "studio", url: "wss://relay.polaris.lux.dev/v1" },
  ]);
});

test("your own relay: the switch waits for its URL, turns on with it, and Polaris Cloud goes back", async () => {
  const off = await route("off");
  fake.answerOk("relayRoute.status", off);
  fake.answerOk("devices.list", []);
  answerEnable(off);
  const view = row();

  fireEvent.click(await view.findByRole("button", { name: "Use your own relay" }));
  await view.findByText("Add a relay to turn it on");
  const toggle = view.getByRole("switch", { name: "Polaris Relay" });
  expect(toggle).toHaveProperty("disabled", true);

  fireEvent.click(view.getByRole("button", { name: "Use Polaris Cloud" }));
  await view.findByText("Off · Polaris Cloud");
  expect(toggle).toHaveProperty("disabled", false);

  fireEvent.click(view.getByRole("button", { name: "Use your own relay" }));
  type(view.getByLabelText("Relay URL"), " wss://relay.lucas.dev/v1 ");
  fireEvent.click(toggle);

  await view.findByText("Connected · 0 devices");
  expect(fake.sent("relayRoute.enable")).toEqual([
    { hostKey: "studio", url: "wss://relay.lucas.dev/v1" },
  ]);
});

test("a host that stored its own relay keeps it: the field shows it and on sends it", async () => {
  const off = { ...(await route("off")), url: "wss://relay.lucas.dev/v1" };
  fake.answerOk("relayRoute.status", off);
  fake.answerOk("devices.list", []);
  answerEnable(off);
  const view = row();

  await view.findByText("Off");
  expect(view.getByLabelText("Relay URL")).toHaveProperty("value", "wss://relay.lucas.dev/v1");
  fireEvent.click(view.getByRole("switch", { name: "Polaris Relay" }));

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

test("turned on before the host reaches the relay, it shows Connected once the host does", async () => {
  const off = await route("off");
  let reached = false;
  fake.answer("relayRoute.status", () => ({
    ok: true,
    value: { ...off, state: "on", url: "wss://relay.lucas.dev/v1", connected: reached },
  }));
  fake.answerOk("devices.list", []);
  render(<RelayRoute hostKey="studio" hostLabel="Mac Studio" pollMs={10} />);
  const view = within(document.body);

  await view.findByText("Connecting…");
  reached = true;

  await view.findByText("Connected · 0 devices");
});

test("the footer's address is the relay the switch would use, or uses once on", async () => {
  const off = await route("off");
  const on = { ...off, state: "on" as const, url: "wss://relay.lucas.dev/v1" };

  expect(relayAddress(off, false, "")).toBe("wss://relay.polaris.lux.dev/v1");
  expect(relayAddress(off, true, " wss://mine.dev/v1 ")).toBe("wss://mine.dev/v1");
  expect(relayAddress(on, false, "")).toBe("wss://relay.lucas.dev/v1");
});
