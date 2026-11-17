import { expect, test } from "bun:test";
import { noteHostKinds } from "../../store/hostKinds.ts";
import { refusalText } from "./dispatch.ts";

const refused = (what: string) => ({
  code: "UserAccessRequired",
  message: `${what} is only for a Desktop App this Host has enrolled`,
});

test("a refused approval on a 0.9.0 daemon names the host and how to move user access here", () => {
  noteHostKinds([{ key: "pi", kind: "ssh", label: "lucas-rpi" }]);

  expect(refusalText(refused("dispatch:RespondToApproval"), "pi")).toBe(
    "This desktop app can't approve on lucas-rpi yet: another one holds user access. To move it here, delete ~/.polaris/user-access.json on lucas-rpi and reconnect."
  );
});

test("another user-only action on the local host says so in running text", () => {
  noteHostKinds([{ key: "local", kind: "local", label: "Mac Studio" }]);

  expect(refusalText(refused("secret.provide"), "local")).toStartWith(
    "This desktop app can't do this on this Mac yet:"
  );
});

test("a Daemon's own refusal still reads as its reason", () => {
  expect(
    refusalText({ code: "CommandRejected", message: "CommandRejected: interrupt the turn first" })
  ).toBe("Interrupt the turn first");
});

test("an approval someone else answered first says so, without the request's id", () => {
  expect(
    refusalText({
      code: "CommandRejected",
      message: "CommandRejected: request turn_d86ba26d-item-0-approval is already resolved",
    })
  ).toBe("This request was already answered.");
});
