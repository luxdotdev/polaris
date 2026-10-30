/**
 * A stand-in Desktop App for the CDP smoke (ENG-616): real `WebContentsView`s behind the
 * `CdpTabs` port, each Unix-socket connection served as a `cdp` stream by the facade. Bundled
 * and launched by `apps/daemon/src/browser/smoke.e2e.test.ts`; not part of the app.
 */
import { createServer } from "node:net";
import { CdpMessageDecoder, encodeCdpMessage, SessionId } from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import { app, BrowserWindow, session, WebContentsView } from "electron";
import {
  BrowserTab,
  BrowserTabEvent,
  BrowserTabId,
  BrowserTabOpener,
} from "../../../shared/browserContract.ts";
import { cdpFacade } from "../facade.ts";
import type { CdpTabs } from "../ports.ts";

const socketPath = process.env.POLARIS_SMOKE_SOCKET ?? "";

const startUrl = process.env.POLARIS_SMOKE_URL ?? "about:blank";

const mine = SessionId.make("mine");

const theirs = SessionId.make("theirs");

interface Held {
  tab: BrowserTab;
  readonly view: WebContentsView;
}

const held = new Map<BrowserTabId, Held>();

const listeners = new Map<SessionId, Set<(event: BrowserTabEvent) => void>>();

const publish = (sessionId: SessionId, event: BrowserTabEvent) => {
  for (const listener of listeners.get(sessionId) ?? []) listener(event);
};

let window: BrowserWindow | null = null;

let next = 1;

const withFields = (tab: BrowserTab, fields: Partial<typeof BrowserTabEvent.cases.Changed.Type>) =>
  new BrowserTab({
    tabId: tab.tabId,
    sessionId: tab.sessionId,
    openedBy: tab.openedBy,
    url: fields.url ?? tab.url,
    title: fields.title === undefined ? tab.title : fields.title,
    loading: fields.loading ?? tab.loading,
    canGoBack: fields.canGoBack ?? tab.canGoBack,
    canGoForward: fields.canGoForward ?? tab.canGoForward,
    hostAddress: fields.hostAddress ?? tab.hostAddress,
    agentDriving: fields.agentDriving ?? tab.agentDriving,
  });

const changed = (entry: Held) => {
  const contents = entry.view.webContents;
  entry.tab = withFields(entry.tab, {
    url: contents.getURL(),
    title: contents.getTitle() || null,
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  });
  const { tab } = entry;
  publish(
    tab.sessionId,
    BrowserTabEvent.cases.Changed.make({
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
      loading: tab.loading,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      hostAddress: tab.hostAddress,
      agentDriving: tab.agentDriving,
    })
  );
};

const open = async (sessionId: SessionId, url: string, openedBy: BrowserTabOpener) => {
  const view = new WebContentsView({
    webPreferences: {
      backgroundThrottling: false,
      offscreen: process.env.POLARIS_SMOKE_OFFSCREEN === "1",
      // One partition per session here, as the Browser keeps one per Workspace.
      partition: `smoke-${sessionId}`,
    },
  });

  const tabId = BrowserTabId.make(`smoke-${next++}`);

  const tab = new BrowserTab({
    tabId,
    sessionId,
    url,
    title: null,
    loading: true,
    canGoBack: false,
    canGoForward: false,
    hostAddress: false,
    agentDriving: false,
    openedBy,
  });

  const entry: Held = { tab, view };
  held.set(tabId, entry);
  window?.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1000, height: 700 });

  const update = () => changed(entry);
  view.webContents.on("did-navigate", update);
  view.webContents.on("did-navigate-in-page", update);
  view.webContents.on("page-title-updated", update);
  view.webContents.on("did-stop-loading", update);
  publish(
    sessionId,
    BrowserTabEvent.cases.Opened.make({ tab, byAgent: !Predicate.isTagged("User")(openedBy) })
  );
  await view.webContents.loadURL(url).catch(() => undefined);

  return entry.tab;
};

const sessionTabs = (sessionId: SessionId) =>
  Array.from(held.values(), (entry) => entry.tab).filter((tab) => tab.sessionId === sessionId);

const tabs: CdpTabs = {
  sessionTabs: (_host, sessionId) => sessionTabs(sessionId),
  hasTabs: (_host, sessionId) => sessionTabs(sessionId).length > 0,
  debuggeeOf: (tabId) => held.get(tabId)?.view.webContents.debugger ?? null,
  openTab: (input) => open(input.sessionId, input.url, input.openedBy),
  closeTab: async ({ tabId }) => {
    const entry = held.get(tabId);

    if (entry === undefined) return;
    held.delete(tabId);
    window?.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    publish(entry.tab.sessionId, BrowserTabEvent.cases.Closed.make({ tabId }));
  },
  activateTab: async () => undefined,
  allowsUrl: (url) => /^(https?:|about:blank$)/.test(url),
  setAgentDriving: (tabId, driving) => {
    const entry = held.get(tabId);

    if (entry === undefined) return;
    entry.tab = withFields(entry.tab, { agentDriving: driving });
    console.log(`DRIVING ${tabId} ${driving}`);
  },
  subscribe: (_host, sessionId, listener) => {
    const set = listeners.get(sessionId) ?? new Set();
    set.add(listener);
    listeners.set(sessionId, set);
    listener(
      BrowserTabEvent.cases.Snapshot.make({ tabs: sessionTabs(sessionId), activeTabId: null })
    );

    return () => void set.delete(listener);
  },
};

const serve = () =>
  createServer((socket) => {
    const decoder = new CdpMessageDecoder();

    const facade = cdpFacade({
      hostKey: "local",
      sessionId: mine,
      tabs,
      send: (message) => void socket.write(encodeCdpMessage(message)),
      overflow: () => socket.destroy(),
      versions: {
        chrome: process.versions.chrome ?? "",
        v8: process.versions.v8 ?? "",
        userAgent: "Polaris Smoke",
      },
    });

    socket.on("data", (chunk: Buffer) => {
      try {
        for (const message of decoder.feed(new Uint8Array(chunk))) facade.receive(message);
      } catch (error) {
        console.log(`FRAMING ${String(error)}`);
        socket.destroy();
      }
    });
    socket.on("close", () => facade.close());
    socket.on("error", () => facade.close());
  }).listen(socketPath, () => console.log("READY"));

const Cookies = Schema.Struct({ cookies: Schema.Array(Schema.Struct({ name: Schema.String })) });

const cookieNames = Schema.decodeUnknownSync(Cookies);

/**
 * What a tab session's cookie methods reach: set one in `theirs`' partition, then read and
 * clear from `mine`'s. Logged as `COOKIES {...}` for the smoke to assert.
 */
const cookieCheck = async () => {
  const [theirs, mine] = Array.from(held.values(), (entry) => entry.view.webContents.debugger);

  if (theirs === undefined || mine === undefined) return;
  theirs.attach("1.3");
  mine.attach("1.3");
  await theirs.sendCommand("Network.setCookie", {
    name: "polaris",
    value: "theirs",
    url: startUrl,
  });
  const seenByMine = cookieNames(await mine.sendCommand("Network.getAllCookies")).cookies;
  const seenByTheirs = cookieNames(await theirs.sendCommand("Network.getAllCookies")).cookies;
  const seenByDefault = await session.defaultSession.cookies.get({});
  await mine.sendCommand("Network.clearBrowserCookies");
  const afterClear = cookieNames(await theirs.sendCommand("Network.getAllCookies")).cookies;
  await theirs.sendCommand("Network.clearBrowserCookies");
  theirs.detach();
  mine.detach();
  const names = (cookies: ReadonlyArray<{ readonly name: string }>) => cookies.map((c) => c.name);
  console.log(
    `COOKIES ${JSON.stringify({
      theirs: names(seenByTheirs),
      mine: names(seenByMine),
      default: names(seenByDefault),
      theirsAfterMineCleared: names(afterClear),
    })}`
  );
};

console.log("BOOT");

process.on("uncaughtException", (error: Error) => console.log(`UNCAUGHT ${String(error)}`));

app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: process.env.POLARIS_SMOKE_SHOW === "1",
      width: 1000,
      height: 700,
    });
    await open(theirs, "about:blank", BrowserTabOpener.cases.User.make({}));
    await open(mine, startUrl, BrowserTabOpener.cases.User.make({}));
    await cookieCheck().catch((error: Error) => console.log(`COOKIES-FAILED ${String(error)}`));
    serve();
  })
  .catch((error: Error) => console.log(`FAILED ${String(error)}`));

app.on("window-all-closed", () => undefined);

process.on("SIGTERM", () => app.quit());

process.stdin.on("end", () => app.quit());

process.stdin.resume();
