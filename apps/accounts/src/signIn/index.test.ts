import { expect, test } from "bun:test";
import { isDeviceRedirect, signInRequestOf } from "./index.ts";

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
])("an authorization code may be handed to %s: %p", (url, allowed) => {
  expect(isDeviceRedirect(url)).toBe(allowed);
});

const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const query = (overrides: Record<string, string | null>) => {
  const params = new URLSearchParams({
    redirect_uri: "polaris://signed-in",
    state: "s1",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  return params;
};

test.each([
  ["no challenge", { code_challenge: null }],
  ["a plain challenge", { code_challenge_method: "plain" }],
  ["no method", { code_challenge_method: null }],
  ["a short challenge", { code_challenge: "abc" }],
  ["no state", { state: null }],
  ["a web redirect", { redirect_uri: "https://attacker.example/cb" }],
])("sign-in refuses %s", (_, overrides) => {
  expect(signInRequestOf(query(overrides))).toBeUndefined();
});

test("sign-in takes a polaris: redirect with an S256 challenge and a state", () => {
  expect(signInRequestOf(query({}))).toEqual({
    redirectUri: "polaris://signed-in",
    state: "s1",
    codeChallenge: challenge,
  });
});
