import { expect, test } from "bun:test";
import { isDeviceRedirect } from "./pages.ts";

test.each([
  ["http://127.0.0.1:53682/callback", true],
  ["http://localhost:4000/cb", true],
  ["http://[::1]:4000/cb", true],
  ["polaris://signed-in", true],
  ["https://127.0.0.1/cb", false],
  ["http://127.0.0.1.attacker.example/cb", false],
  ["https://attacker.example/cb", false],
  ["javascript:alert(1)", false],
  ["not a url", false],
])("a session token may be handed to %s: %p", (url, allowed) => {
  expect(isDeviceRedirect(url)).toBe(allowed);
});
