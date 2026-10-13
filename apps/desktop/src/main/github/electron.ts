/**
 * The GitHub client's Electron side: the endpoints from the environment, and window
 * focus setting the poll rate. Tokens go through `SecureStorage` (`../secure/electron.ts`).
 */
import { join } from "node:path";
import { Effect, Layer, Stream, SubscriptionRef } from "effect";
import { app, BrowserWindow } from "electron";
import type { GitHubAccountsView, PullListView } from "../../shared/github.ts";
import type { ClientRuntime } from "../hosts.ts";
import type { SecureStorage } from "../secure/index.ts";
import { type EndpointEnv, endpointsFrom } from "./config.ts";
import { GitHub } from "./index.ts";

export interface GitHubLayerInput {
  readonly userData: string;
  readonly env: EndpointEnv;
  readonly secureStorage: Layer.Layer<SecureStorage>;
}

export const githubLayer = ({ userData, env, secureStorage }: GitHubLayerInput) =>
  GitHub.layer({
    dir: join(userData, "github"),
    fetch: (url, init) => fetch(url, init),
    endpoints: endpointsFrom(env),
  }).pipe(Layer.provide(secureStorage));

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
