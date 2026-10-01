/**
 * The GitHub client's Electron side: `safeStorage` (async API) as its keychain,
 * the endpoints from the environment, and window focus setting the poll rate.
 */
import { join } from "node:path";
import { Effect, Stream, SubscriptionRef } from "effect";
import { app, BrowserWindow, safeStorage } from "electron";
import type { GitHubAccountsView, PullListView } from "../../shared/github.ts";
import type { ClientRuntime } from "../hosts.ts";
import { type EndpointEnv, endpointsFrom } from "./config.ts";
import { GitHub } from "./index.ts";
import type { Crypto } from "./store.ts";

/** On Linux, `basic_text` "encrypts" with a hardcoded password: refuse to store tokens. */
const keychainAvailable = async () =>
  (await safeStorage.isAsyncEncryptionAvailable()) &&
  !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text");

export const keychain: Crypto = {
  available: keychainAvailable,
  encrypt: async (plain) => new Uint8Array(await safeStorage.encryptStringAsync(plain)),
  decrypt: async (sealed) => {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(sealed));

    return { text: result, shouldReEncrypt };
  },
};

export interface GitHubLayerInput {
  readonly userData: string;
  readonly env: EndpointEnv;
}

export const githubLayer = ({ userData, env }: GitHubLayerInput) =>
  GitHub.layer({
    dir: join(userData, "github"),
    crypto: keychain,
    fetch: (url, init) => fetch(url, init),
    endpoints: endpointsFrom(env),
  });

/** Polls every minute while a Polaris window is focused, every five otherwise. */
export const followFocus = (runtime: ClientRuntime) => {
  const set = (focused: boolean) => runtime.runFork(GitHub.use((g) => g.setFocused(focused)));

  app.on("browser-window-focus", () => set(true));
  // Focus moving between two Polaris windows blurs one first.
  app.on("browser-window-blur", () =>
    setImmediate(() => {
      if (BrowserWindow.getFocusedWindow() === null) set(false);
    })
  );
};

/** The accounts and every PR list the client publishes, for review-request notifications. */
export const followReviewRequests = (
  runtime: ClientRuntime,
  notifier: {
    readonly accounts: (view: GitHubAccountsView) => void;
    readonly update: (list: PullListView) => void;
  }
) => {
  runtime.runFork(
    GitHub.use((g) =>
      SubscriptionRef.changes(g.accounts).pipe(
        Stream.runForEach((view) => Effect.sync(() => notifier.accounts(view)))
      )
    )
  );
  runtime.runFork(
    GitHub.use((g) =>
      SubscriptionRef.changes(g.pulls).pipe(
        Stream.runForEach((list) => Effect.sync(() => notifier.update(list)))
      )
    )
  );
};
