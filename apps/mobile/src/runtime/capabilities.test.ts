import { expect, test } from "bun:test";
import { SDK_CAPABILITIES } from "@polaris/sdk";
import { MOBILE_CAPABILITIES } from "./capabilities.ts";

test("the phone is sent Secret Requests; an Extension on the SDK never is", () => {
  expect(MOBILE_CAPABILITIES).toContain("approval.secret");
  expect(SDK_CAPABILITIES).not.toContain("approval.secret");
});
