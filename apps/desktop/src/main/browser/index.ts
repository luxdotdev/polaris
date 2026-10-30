/**
 * Agent Sessions' Browsers in main (ENG-615, ADR 0092): the registry of tabs, their Electron
 * views, claims on the Host when one is shown, and the `browser.*` IPC handlers and feed.
 */
import type { SessionId, WorkspaceId } from "@polaris/protocol";
import { randomUUID } from "node:crypto";
import { Effect, Option, Predicate, Stream } from "effect";
import type { BrowserWindow } from "electron";
import type { BrowserTabId } from "../../shared/browserContract.ts";
import { type ClientRuntime, HostDirectory } from "../hosts.ts";
import { openKeptTabs } from "./keptFile.ts";
import { createRegistry, type Hosting } from "./registry.ts";
import { electronViews } from "./views.ts";

export { BrowserRefused, type OpenTab, type Registry } from "./registry.ts";

export { allowedUrl, isHostAddress, isHostAddressName, urlFromInput } from "./navigation.ts";

export { browserPartition } from "./views.ts";

export { browserHandlers, browserOpeners } from "./ipc.ts";

export interface BrowsersInput {
  readonly runtime: ClientRuntime;
  readonly userData: string;
  readonly window: () => BrowserWindow | null;
  /** H's partition setup (`configureBrowserSession`); none leaves the partition as Electron makes it. */
  readonly configureSession?: (
    hostKey: string,
    workspaceId: WorkspaceId,
    partition: Electron.Session
  ) => Promise<void>;
}

const live = (hostKey: string) =>
  HostDirectory.use((dir) => dir.connection(hostKey)).pipe(Effect.flatMap((c) => c.session));

/** Claims follow the Browser on screen; a Daemon without `browser.host` refuses, which is fine. */
const hostingOn = (runtime: ClientRuntime): Hosting => {
  const run = (label: string, effect: Effect.Effect<unknown, unknown, HostDirectory>) =>
    runtime.runFork(
      effect.pipe(
        Effect.catchCause((cause) => Effect.logDebug(`[browser] ${label} refused`, cause))
      )
    );

  return {
    claim: (hostKey, sessionId) =>
      run(
        "claim",
        live(hostKey).pipe(Effect.flatMap((s) => s.client["browser.claim"]({ sessionId })))
      ),
    release: (hostKey, sessionId) =>
      run(
        "release",
        live(hostKey).pipe(Effect.flatMap((s) => s.client["browser.release"]({ sessionId })))
      ),
  };
};

/** The session's Workspace, from its snapshot on the Host. */
const workspaceOn =
  (runtime: ClientRuntime) =>
  (hostKey: string, sessionId: SessionId): Promise<WorkspaceId | null> =>
    runtime.runPromise(
      HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
        // A session feed opens with its Snapshot.
        Effect.flatMap((c) => Stream.runHead(c.subscribeSession(sessionId, { turnLimit: 0 }))),
        Effect.map((first) =>
          Option.isSome(first) && Predicate.isTagged(first.value, "Snapshot")
            ? first.value.session.workspaceId
            : null
        ),
        Effect.orElseSucceed(() => null)
      )
    );

export const createBrowsers = (input: BrowsersInput) => {
  const file = openKeptTabs(input.userData);
  const prefix = randomUUID().slice(0, 8);
  let counter = 0;
  let registry: ReturnType<typeof createRegistry> | null = null;

  const views = electronViews({
    window: input.window,
    configureSession: input.configureSession ?? (() => Promise.resolve()),
    onChange: (tabId, change) => registry?.tabChanged(tabId, change),
    onPopup: (from, url) => {
      const state = registry?.sessionOfTab(from);
      const opener = state?.tabs.find((tab) => tab.tabId === from)?.openedBy;

      if (state == null || opener === undefined) return;
      void registry
        ?.openTab({ ...state, url, openedBy: opener })
        .catch((cause: unknown) => console.warn("[browser] popup refused", cause));
    },
  });

  registry = createRegistry({
    views: views.host,
    hosting: hostingOn(input.runtime),
    kept: file.read(),
    save: file.save,
    // SAFETY: main mints every tab id, unique for this run.
    nextId: () => `${prefix}-${++counter}` as BrowserTabId,
    workspaceOf: workspaceOn(input.runtime),
  });

  return { ...registry, contentsOf: views.contentsOf, flush: file.flush };
};

export type Browsers = ReturnType<typeof createBrowsers>;
