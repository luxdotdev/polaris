import "../../test/dom.testing.ts";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Result } from "../../../shared/api.ts";
import type { LinkResultView } from "../../../shared/linkedDevicesContract.ts";
import { type FakeBridge, installFakeBridge } from "../../test/bridge.testing.ts";
import { Devices } from "./DevicesPage.tsx";
import { host, noiseKey, phone, route } from "./fixture.testing.ts";

let fake: FakeBridge;

beforeEach(() => {
  fake = installFakeBridge();
});

afterEach(cleanup);

const LINK = "polaris-link:v2:secret-part";

const hosts = [host("studio", "Mac Studio"), host("pi", "Raspberry Pi 4")];

/** Both Hosts on the relay; `devices.finishLink` waits for the returned `finish`. */
const relayOn = async () => {
  const on = await route("on");
  fake.answerOk("relayRoute.status", on);
  fake.answerOk("devices.list", []);
  fake.answerOk("devices.startLink", {
    hostKey: "studio",
    linkId: "link-1",
    linkString: LINK,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    shareTo: ["pi"],
  });

  const finish = Promise.withResolvers<Result<LinkResultView>>();
  fake.answer("devices.finishLink", () => finish.promise);

  return finish;
};

const page = (onOpenHosts: () => void = () => undefined) =>
  within(render(<Devices hosts={hosts} onOpenHosts={onOpenHosts} />).container);

const lists = () => fake.sent("devices.list").length;

test("linking shows the link as a QR code, copies it through the clearing clipboard, and reloads once linked", async () => {
  const finish = await relayOn();
  const view = page();

  fireEvent.click(await view.findByRole("button", { name: "Link a device" }));

  expect(await view.findByRole("img", { name: "Link QR code" })).toBeTruthy();
  expect(
    view.getByText(/reaches Mac Studio and Raspberry Pi 4 through the Polaris Relay/)
  ).toBeTruthy();
  expect(view.queryByText(LINK)).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Copy link" }));
  await view.findByRole("button", { name: "Copied" });
  expect(fake.sent("clipboard.writeSecret")).toEqual([{ text: LINK }]);
  expect(fake.sent("devices.finishLink")).toEqual([
    { hostKey: "studio", linkId: "link-1", shareTo: ["pi"] },
  ]);

  const before = lists();
  finish.resolve({
    ok: true,
    value: { device: await phone({ noiseKey: noiseKey() }), shares: [{ hostKey: "pi", ok: true }] },
  });

  await waitFor(() => expect(lists()).toBeGreaterThan(before));
  expect(view.queryByRole("img", { name: "Link QR code" })).toBeNull();
});

test("after Cancel, a phone that links late doesn't reopen the panel", async () => {
  const finish = await relayOn();
  const view = page();

  fireEvent.click(await view.findByRole("button", { name: "Link a device" }));
  await view.findByRole("img", { name: "Link QR code" });
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));

  const before = lists();
  finish.resolve({ ok: false, error: { code: "Expired", message: "The link expired." } });
  await new Promise((settle) => setTimeout(settle, 20));

  expect(view.getByRole("button", { name: "Link a device" })).toBeTruthy();
  expect(view.queryByText(/The link ended/)).toBeNull();
  expect(lists()).toBe(before);
});

test("unlinking a device unlinks it on every host it's on", async () => {
  const iphone = noiseKey();
  const onStudio = await phone({ noiseKey: iphone });
  const onPi = await phone({ noiseKey: iphone });
  fake.answerOk("relayRoute.status", await route("on"));
  fake.answer("devices.list", ({ hostKey }) => ({
    ok: true,
    value: [hostKey === "studio" ? onStudio : onPi],
  }));
  const view = page();

  const row = within(await view.findByTestId("device-row"));
  expect(row.getByText("Linked Oct 20 · on 2 hosts")).toBeTruthy();
  fireEvent.click(row.getByRole("button", { name: "Unlink" }));
  fireEvent.click(row.getByRole("button", { name: "Unlink Lucas's iPhone" }));

  await waitFor(() =>
    expect(fake.sent("devices.unlink")).toEqual([
      { hostKey: "studio", id: onStudio.id },
      { hostKey: "pi", id: onPi.id },
    ])
  );
});

test("Retry shares a device with the host it missed", async () => {
  const device = await phone({ noiseKey: noiseKey() });
  fake.answerOk("relayRoute.status", await route("on"));
  fake.answer("devices.list", ({ hostKey }) => ({
    ok: true,
    value: hostKey === "studio" ? [device] : [],
  }));
  const view = page();

  const row = within(await view.findByTestId("device-row"));
  expect(row.getByText(/not shared with Raspberry Pi 4/)).toBeTruthy();
  fireEvent.click(row.getByRole("button", { name: "Retry" }));

  await waitFor(() =>
    expect(fake.sent("devices.share")).toEqual([
      {
        hostKey: "pi",
        name: device.name,
        relayAddress: device.relayAddress,
        noiseKey: device.noiseKey,
      },
    ])
  );
});

test("with the relay off everywhere, linking points to Hosts instead", async () => {
  fake.answerOk("relayRoute.status", await route("off"));
  fake.answerOk("devices.list", []);
  const opened: Array<true> = [];
  const view = page(() => opened.push(true));

  await view.findAllByText("Relay off");
  expect(view.queryByRole("button", { name: "Link a device" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Open hosts" }));

  for (const turnOn of view.getAllByRole("button", { name: "Turn on" })) fireEvent.click(turnOn);

  expect(opened).toEqual([true, true, true]);
});
