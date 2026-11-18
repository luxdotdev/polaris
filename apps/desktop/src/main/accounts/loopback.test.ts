import { expect, test } from "bun:test";
import { Effect } from "effect";
import { loopbackAuthorizer } from "./loopback.ts";

const SIGN_IN = "https://auth.example/sign-in?state=s-ours&code_challenge=c";

/** What a local page sees: its status and the copy on it. */
const visit = async (url: string) => {
  // A browser tab on this machine, not a main-process internet request.
  const response = await globalThis.fetch(url);

  const body = await response.text();

  return [response.status, /<p>(.*)<\/p>/.exec(body)?.[1] ?? body] as const;
};

test("a stray return to the loopback is ignored; the matching one ends the sign-in, neutrally", async () => {
  const seen: Array<readonly [number, string]> = [];

  const returned = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let redirect = "";

        const auth = yield* loopbackAuthorizer(async () => {
          seen.push(await visit(`${redirect}?code=evil&state=s-theirs`));
          seen.push(await visit(`${redirect}?code=evil`));
          seen.push(await visit(`${redirect}?code=good&state=s-ours`));
        });

        redirect = auth.redirectUri;

        return yield* auth.open(SIGN_IN);
      })
    )
  );

  expect(new URL(returned).searchParams.get("code")).toBe("good");
  expect(seen).toEqual([
    [400, "Polaris isn't waiting for this sign-in. Start again from Polaris."],
    [400, "Polaris isn't waiting for this sign-in. Start again from Polaris."],
    [200, "You can close this tab and return to Polaris."],
  ]);
});
