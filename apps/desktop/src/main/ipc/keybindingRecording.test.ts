import { expect, test } from "bun:test";
import { keybindingRecording, type RecordingOrigin } from "./keybindingRecording.ts";

const fixture = () => {
  let ignored = false;
  let navigate = (_details: { isMainFrame: boolean; isSameDocument: boolean }) => {};

  const sender: RecordingOrigin["sender"] = {
    setIgnoreMenuShortcuts: (active) => {
      ignored = active;
    },
    isDestroyed: () => false,
    on: (_name, listener) => {
      navigate = listener;
    },
  };

  return {
    sender,
    target: () => (ignored ? "recorder" : "native menu"),
    navigate: (details: Parameters<typeof navigate>[0]) => navigate(details),
  };
};

test("only a trusted renderer with a boolean can divert native accelerators to the recorder", () => {
  const f = fixture();
  const handle = keybindingRecording((url) => url === "app://polaris");
  expect(handle({ sender: f.sender, senderFrame: { url: "https://foreign.example" } }, true)).toBe(
    false
  );
  expect(f.target()).toBe("native menu");
  const origin = { sender: f.sender, senderFrame: { url: "app://polaris" } };
  expect(handle(origin, "true")).toBe(false);
  expect(f.target()).toBe("native menu");
  expect(handle(origin, true)).toBe(true);
  expect(f.target()).toBe("recorder");
  handle(origin, false);
  expect(f.target()).toBe("native menu");
});

test("navigation restores native shortcuts even when the recorder's cleanup cannot run", () => {
  const f = fixture();
  const handle = keybindingRecording(() => true);
  handle({ sender: f.sender, senderFrame: { url: "app://polaris" } }, true);
  f.navigate({ isMainFrame: false, isSameDocument: false });
  expect(f.target()).toBe("recorder");
  f.navigate({ isMainFrame: true, isSameDocument: false });
  expect(f.target()).toBe("native menu");
});
