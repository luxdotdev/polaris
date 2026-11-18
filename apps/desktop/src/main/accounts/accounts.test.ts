import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLARIS_CLOUD_ACCOUNTS_URL } from "@polaris/protocol";
import { fakeAccountServer, fakeServers } from "@polaris/client/accounts/testing";
import { Effect, Layer, ManagedRuntime, Option, Stream, SubscriptionRef } from "effect";
import type { PolarisAccountsView } from "../../shared/accountsContract.ts";
import { SecureStorage } from "../secure/index.ts";
import { DesktopAccounts } from "./index.ts";

const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** The system browser: follows the sign-in to its redirect, then loads it as a browser would. */
const browserFor =
  (redirectFor: (url: string) => string) =>
  async (url: string): Promise<void> => {
    if (!url.startsWith(POLARIS_CLOUD_ACCOUNTS_URL) && !url.startsWith("https://team.example"))
      throw new Error(`opened ${url}`);
    // The browser loading the loopback page, not a main-process internet request.
    const response = await globalThis.fetch(redirectFor(url));

    if (!response.ok) throw new Error(`loopback answered ${response.status}`);
  };

const start = () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-accounts-"));
  dirs.push(dir);
  const cloud = fakeAccountServer(POLARIS_CLOUD_ACCOUNTS_URL);
  const team = fakeAccountServer("https://team.example");
  const servers = fakeServers(cloud, team);

  const fetch = (url: string, init?: RequestInit) =>
    url === "https://avatars.example/octocat.png"
      ? Promise.resolve(new Response(PNG, { headers: { "content-type": "image/png" } }))
      : servers(url, init);

  const redirectFor = (url: string) =>
    new URL(url).origin === team.origin ? team.redirectFor(url) : cloud.redirectFor(url);

  const runtime = ManagedRuntime.make(
    DesktopAccounts.layer({ dir, fetch, openExternal: browserFor(redirectFor) }).pipe(
      Layer.provideMerge(SecureStorage.memory)
    )
  );

  const until = (done: (view: PolarisAccountsView) => boolean) =>
    runtime.runPromise(
      DesktopAccounts.use((a) =>
        SubscriptionRef.changes(a.view).pipe(
          Stream.filter(done),
          Stream.runHead,
          Effect.map(Option.getOrThrow)
        )
      )
    );

  return { dir, cloud, team, runtime, until };
};

test("signs in through the browser and the loopback return, to Polaris Cloud by default", async () => {
  const { dir, runtime, until } = start();

  await runtime.runPromise(DesktopAccounts.use((a) => a.signIn()));
  await until((v) => v.accounts.length === 1 && v.signIn === null);
  const view = await runtime.runPromise(DesktopAccounts.use((a) => SubscriptionRef.get(a.view)));

  expect(view.accounts.map((a) => [a.serverLabel, a.login])).toEqual([
    ["Polaris Cloud", "octocat"],
  ]);
  expect(view.failure).toBeNull();
  // The token stays in the secret store: neither the view nor the list on disk carries it.
  expect(JSON.stringify(view)).not.toContain('"t1"');
  expect(readFileSync(join(dir, "accounts.json"), "utf8")).not.toContain('"t1"');
  await runtime.dispose();
});

test("two servers at once; signing out of one leaves the other signed in", async () => {
  const { team, runtime, until } = start();
  team.signInAs({ personId: "p2", login: "hubot" });

  await runtime.runPromise(DesktopAccounts.use((a) => a.signIn()));
  await until((v) => v.accounts.length === 1 && v.signIn === null);
  await runtime.runPromise(DesktopAccounts.use((a) => a.signIn("team.example")));
  const both = await until((v) => v.accounts.length === 2 && v.signIn === null);
  const cloudId = both.accounts.find((a) => a.isPolarisCloud)?.id ?? "";

  await runtime.runPromise(DesktopAccounts.use((a) => a.signOut(cloudId)));
  const after = await until((v) => v.accounts.length === 1);

  expect(after.accounts.map((a) => [a.serverLabel, a.login, a.signedOutAt])).toEqual([
    ["team.example", "hubot", null],
  ]);
  expect(team.calls).not.toContain("POST /api/auth/sign-out");
  await runtime.dispose();
});

test("a server that isn't https is refused before the browser opens", async () => {
  const { runtime, until } = start();

  await runtime.runPromise(DesktopAccounts.use((a) => a.signIn("http://team.example")));
  const view = await until((v) => v.failure !== null);

  expect(view.failure?.message).toBe("an account server needs https");
  expect(view.accounts).toEqual([]);
  await runtime.dispose();
});
