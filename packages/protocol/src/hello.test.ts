import { expect, test } from "bun:test";
import { decideProtocol, ProtocolMismatch } from "./hello.ts";

test("a Daemon inside the Extension's range is accepted; outside it, the older side is named", () => {
  expect(decideProtocol(2, { min: 1, max: 3 }, true)).toBeNull();
  expect(decideProtocol(2, { min: 2, max: 2 }, true)).toBeNull();

  const daemonBehind = decideProtocol(1, { min: 2, max: 3 }, true);
  expect(daemonBehind?.update).toBe("polaris");
  expect(daemonBehind?.message).toBe(
    "This Polaris speaks protocol 1; the Extension needs 2 or newer. Update Polaris."
  );

  const extensionBehind = decideProtocol(4, { min: 2, max: 3 }, false);
  expect(extensionBehind?.update).toBe("extension");
  expect(extensionBehind?.message).toBe(
    "This Polaris speaks protocol 4; the Extension speaks up to 3. Update the Extension."
  );
});

test("a missing range is refused only where one is required", () => {
  expect(decideProtocol(1, undefined, false)).toBeNull();
  expect(decideProtocol(1, undefined, true)).toEqual(
    new ProtocolMismatch({ daemon: 1, extension: null, update: "extension" })
  );
  expect(decideProtocol(1, undefined, true)?.message).toContain("Update the Extension");
});
