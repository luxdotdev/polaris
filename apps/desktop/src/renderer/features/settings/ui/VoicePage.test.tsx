import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { HostView } from "../../../../shared/api.ts";
import type { VoiceSettingsView } from "../../../../shared/voiceContract.ts";
import { installFakeBridge, type FakeBridge } from "../../../test/bridge.testing.ts";
import { standInBridge } from "../../bridge.ts";
import { HostVoice } from "./VoicePage.tsx";

let fake: FakeBridge;

beforeEach(() => {
  fake = installFakeBridge();
});

afterEach(() => {
  cleanup();
  standInBridge(null);
});

const KEY = "0123456789abcdef0123456789abcdef01234567";

const host = (capabilities: ReadonlyArray<string> = ["voice"]): HostView => ({
  key: "studio",
  label: "Mac Studio",
  colour: null,
  alias: "studio",
  kind: "ssh",
  proofHarness: false,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: null,
    // SAFETY: test Hosts announce only real capability names.
    capabilities: capabilities as HostView["status"]["capabilities"],
    epoch: 0,
    latencyMs: null,
    lastSeenAt: null,
  },
});

const settings = (keySet: boolean, store: VoiceSettingsView["store"]): VoiceSettingsView => ({
  provider: "deepgram",
  keySet,
  store,
});

/** happy-dom lacks `oninput`, so React watches the focused field's value on key events. */
const type = (field: HTMLInputElement, value: string) => {
  act(() => field.focus());
  fireEvent.change(field, { target: { value } });
  fireEvent.keyUp(field, { key: "a" });
};

const field = (view: { readonly getByLabelText: (text: string) => HTMLElement }) => {
  const element = view.getByLabelText("Deepgram key");

  if (!(element instanceof HTMLInputElement)) throw new Error("not an input");

  return element;
};

const open = async (target: HostView = host()) => {
  const view = within(render(<HostVoice host={target} />).container);

  await waitFor(() => view.getByTestId("voice-key-state"));

  return view;
};

test("saving a key sends it once, empties the field, and shows where the host keeps it", async () => {
  fake.answerOk("voice.settings", settings(false, "keychain"));
  fake.answerOk("voice.setKey", settings(true, "keychain"));
  const view = await open();

  type(field(view), KEY);
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })));

  expect(fake.sent("voice.setKey")).toEqual([
    { hostKey: "studio", provider: "deepgram", key: KEY },
  ]);
  expect(field(view).value).toBe("");
  expect(view.getByTestId("voice-key-state").textContent).toBe(
    "Key set, kept in the macOS Keychain on Mac Studio"
  );
  expect(view.getByRole("button", { name: "Remove key" })).not.toBeNull();
});

test("a refused key shows the host's message inline and keeps the field to fix", async () => {
  fake.answerOk("voice.settings", settings(false, "file"));
  fake.refuse("voice.setKey", {
    code: "VoiceError",
    message: "That is not a Deepgram API key: it should be letters and digits only.",
  });
  const view = await open();

  type(field(view), "not a key");
  await act(async () => fireEvent.submit(field(view)));

  expect(view.getByRole("alert").textContent).toBe(
    "That is not a Deepgram API key: it should be letters and digits only."
  );
  expect(field(view).getAttribute("aria-invalid")).toBe("true");
  expect(field(view).value).toBe("not a key");
  expect(view.getByTestId("voice-key-state").textContent).toBe(
    "No key yet; extensions can't use voice on Mac Studio"
  );
});

test("Remove key sends null and the row goes back to no key", async () => {
  fake.answerOk("voice.settings", settings(true, "file"));
  fake.answerOk("voice.setKey", settings(false, "file"));
  const view = await open();

  expect(view.getByTestId("voice-key-state").textContent).toBe(
    "Key set, kept in ~/.polaris/secrets on Mac Studio"
  );
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Remove key" })));

  expect(fake.sent("voice.setKey")).toEqual([
    { hostKey: "studio", provider: "deepgram", key: null },
  ]);
  expect(view.getByTestId("voice-key-state").textContent).toBe(
    "No key yet; extensions can't use voice on Mac Studio"
  );
  expect(view.queryByRole("button", { name: "Remove key" })).toBeNull();
});

test("a blank field can't be saved", async () => {
  fake.answerOk("voice.settings", settings(false, "keychain"));
  const view = await open();

  type(field(view), "   ");
  await act(async () => fireEvent.submit(field(view)));

  expect(fake.sent("voice.setKey")).toEqual([]);
});

test("a host whose daemon predates voice says so and is never asked", () => {
  const view = within(render(<HostVoice host={host([])} />).container);

  expect(view.getByText("The daemon on Mac Studio is too old for voice; upgrade it from Hosts"));
  expect(fake.methods()).toEqual([]);
});
