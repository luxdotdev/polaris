/**
 * The Electron side of Browser tabs: one sandboxed WebContentsView per tab in its Workspace's
 * persistent partition, laid over the window where the renderer's Browser area is. Every
 * navigation, redirect and popup passes `allowedUrl`; a popup becomes a tab in the same session.
 */
import type { WorkspaceId } from "@polaris/protocol";
import { type BrowserWindow, session, type WebContents, WebContentsView } from "electron";
import type { BrowserTab, BrowserTabId } from "../../shared/browserContract.ts";
import { allowedFrameUrl, allowedUrl, isHostAddress } from "./navigation.ts";
import { latestLoads } from "./order.ts";
import { distrustInSession } from "../tls/distrust.ts";
import type { TabChange, ViewHost } from "./registry.ts";

/** The Workspace's partition: its logins and cookies, shared by its sessions' Browsers. */
export const browserPartition = (hostKey: string, workspaceId: string) =>
  `persist:polaris-browser-${hostKey}-${workspaceId}`;

export interface ViewsDeps {
  /** The window the Browser shows in. */
  readonly window: () => BrowserWindow | null;
  /** Sets up a partition before its first load (Host addresses through the Host); idempotent. */
  readonly configureSession: (
    hostKey: string,
    workspaceId: WorkspaceId,
    partition: Electron.Session
  ) => Promise<void>;
  readonly onChange: (tabId: BrowserTabId, change: Partial<TabChange>) => void;
  /** The page asked for a new window at an allowed URL. */
  readonly onPopup: (from: BrowserTabId, url: string) => void;
}

const history = (contents: WebContents) => ({
  canGoBack: contents.navigationHistory.canGoBack(),
  canGoForward: contents.navigationHistory.canGoForward(),
});

/** Keeps the tab's model in step with its page, and its page inside the navigation policy. */
const follow = (tabId: BrowserTabId, contents: WebContents, deps: ViewsDeps) => {
  const navigated = (url: string) =>
    deps.onChange(tabId, { url, hostAddress: isHostAddress(url), ...history(contents) });

  contents.on("did-start-loading", () => deps.onChange(tabId, { loading: true }));
  contents.on("did-stop-loading", () =>
    deps.onChange(tabId, { loading: false, ...history(contents) })
  );
  contents.on("did-navigate", (_event, url) => navigated(url));
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) navigated(url);
  });
  contents.on("page-title-updated", (_event, title) => deps.onChange(tabId, { title }));
  contents.on("will-navigate", (event) => {
    if (!allowedUrl(event.url)) event.preventDefault();
  });
  contents.on("will-redirect", (event) => {
    if (!allowedUrl(event.url)) event.preventDefault();
  });
  // Iframes too, so a data: or blob: frame can't slip past the policy.
  contents.on("will-frame-navigate", (event) => {
    if (!allowedFrameUrl(event.url, event.isMainFrame)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (allowedUrl(url)) deps.onPopup(tabId, url);

    return { action: "deny" };
  });
};

export const electronViews = (deps: ViewsDeps) => {
  const views = new Map<BrowserTabId, WebContentsView>();
  const configured = new Map<string, Promise<void>>();

  const configure = (hostKey: string, workspaceId: WorkspaceId) => {
    const name = browserPartition(hostKey, workspaceId);
    const partition = session.fromPartition(name);
    let ready = configured.get(name);

    if (ready === undefined) {
      // Pages get no permissions (camera, notifications, devices…) and the app's TLS distrust list.
      partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      partition.setPermissionCheckHandler(() => false);
      partition.setDevicePermissionHandler(() => false);
      distrustInSession(partition);
      ready = deps.configureSession(hostKey, workspaceId, partition).catch((cause: unknown) => {
        console.warn("[browser] partition setup failed", name, cause);
      });
      configured.set(name, ready);
    }

    return { partition, ready };
  };

  const onWindow = (view: WebContentsView) => {
    const win = deps.window();

    if (win !== null && !win.isDestroyed()) win.contentView.addChildView(view);
  };

  const withView = (tabId: BrowserTabId, use: (view: WebContentsView) => void) => {
    const view = views.get(tabId);

    if (view !== undefined && !view.webContents.isDestroyed()) use(view);
  };

  const ready = new Map<BrowserTabId, Promise<void>>();

  const loads = latestLoads<BrowserTabId>((tabId, url) =>
    withView(tabId, (view) => {
      if (allowedUrl(url)) void view.webContents.loadURL(url).catch(() => {});
    })
  );

  /** Loads once the partition is set up; a later load asked for in the meantime wins. */
  const load = (tabId: BrowserTabId, url: string) =>
    loads.request(tabId, url, ready.get(tabId) ?? Promise.resolve());

  const host: ViewHost = {
    create: (tab: BrowserTab, place) => {
      const { partition, ready: configured } = configure(place.hostKey, place.workspaceId);

      const view = new WebContentsView({
        webPreferences: {
          session: partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          spellcheck: false,
        },
      });

      view.setVisible(false);
      views.set(tab.tabId, view);
      follow(tab.tabId, view.webContents, deps);
      onWindow(view);
      ready.set(tab.tabId, configured);
      load(tab.tabId, tab.url);
    },
    load,
    back: (tabId) =>
      withView(tabId, (view) => {
        if (view.webContents.navigationHistory.canGoBack())
          view.webContents.navigationHistory.goBack();
      }),
    forward: (tabId) =>
      withView(tabId, (view) => {
        if (view.webContents.navigationHistory.canGoForward())
          view.webContents.navigationHistory.goForward();
      }),
    reload: (tabId, ignoreCache) =>
      withView(tabId, (view) =>
        ignoreCache ? view.webContents.reloadIgnoringCache() : view.webContents.reload()
      ),
    devtools: (tabId, open) =>
      withView(tabId, (view) =>
        open ? view.webContents.openDevTools({ mode: "detach" }) : view.webContents.closeDevTools()
      ),
    show: (tabId, bounds) => {
      for (const [id, view] of views) if (id !== tabId) view.setVisible(false);
      withView(tabId, (view) => {
        // Re-adding raises it above anything added since.
        onWindow(view);
        view.setBounds(bounds);
        view.setVisible(bounds.width > 0 && bounds.height > 0);
      });
    },
    hideAll: () => {
      for (const view of views.values()) view.setVisible(false);
    },
    destroy: (tabId) => {
      withView(tabId, (view) => {
        view.setVisible(false);
        deps.window()?.contentView.removeChildView(view);
        view.webContents.close();
      });
      views.delete(tabId);
      ready.delete(tabId);
      loads.forget(tabId);
    },
  };

  return {
    host,
    /** The tab's page, for CDP (ENG-617); null before its view exists. */
    contentsOf: (tabId: BrowserTabId): WebContents | null => {
      const contents = views.get(tabId)?.webContents;

      return contents === undefined || contents.isDestroyed() ? null : contents;
    },
  };
};
