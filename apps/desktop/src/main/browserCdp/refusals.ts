/**
 * Methods the facade refuses (ENG-616, ADR 0092): anything that reaches past the session's
 * own tabs. Without a `sessionId` only the facade's own target methods exist; with one, the
 * methods below are refused before they reach the tab. `README.md` lists them for agents.
 */
import type { CdpJson } from "@polaris/protocol";
import { Option, Schema } from "effect";

/** Refused with or without a `sessionId`. */
export const REFUSED_METHODS: ReadonlySet<string> = new Set([
  "Browser.close",
  "Browser.crash",
  "Browser.crashGpuProcess",
  "Browser.grantPermissions",
  "Browser.resetPermissions",
  "Browser.setPermission",
  "Browser.getWindowForTarget",
  "Browser.getWindowBounds",
  "Browser.setWindowBounds",
  "Browser.setContentsSize",
  "Browser.setDockTile",
  "Browser.executeBrowserCommand",
  "Browser.getBrowserCommandLine",
  "Browser.getHistograms",
  "Browser.getHistogram",
  "Browser.cancelDownload",
  "Browser.addPrivacySandboxEnrollmentOverride",
  "Browser.addPrivacySandboxCoordinatorKeyConfig",
  "Target.createBrowserContext",
  "Target.disposeBrowserContext",
  "Target.getBrowserContexts",
  "Target.setRemoteLocations",
  "Target.exposeDevToolsProtocol",
  "Target.sendMessageToTarget",
  "Target.autoAttachRelated",
  "Target.attachToBrowserTarget",
  // Read files on the Desktop App's machine into a page, or fetch on its behalf.
  "DOM.setFileInputFiles",
  "Page.setInterceptFileChooserDialog",
  "Network.loadNetworkResource",
]);

/** Whole domains that describe or control the Desktop App's Chromium, not a page. */
export const REFUSED_DOMAINS: ReadonlyArray<string> = [
  "SystemInfo",
  "Tethering",
  "Memory",
  "HeadlessExperimental",
  "Extensions",
  "PWA",
  "Autofill",
];

const DownloadBehavior = Schema.Struct({
  behavior: Schema.String,
  downloadPath: Schema.optionalKey(Schema.String),
});

const decodeDownloadBehavior = Schema.decodeUnknownOption(DownloadBehavior);

const DragData = Schema.Struct({
  data: Schema.Struct({ files: Schema.optionalKey(Schema.Array(Schema.String)) }),
});

const decodeDragData = Schema.decodeUnknownOption(DragData);

export const refusalMessage = (method: string) =>
  `${method} is not available through this Browser: it reaches beyond this session's tabs.`;

/** Why `method` is refused, or null when the tab may see it. */
export const refusalOf = (method: string, params: CdpJson | undefined): string | null => {
  if (REFUSED_METHODS.has(method)) return refusalMessage(method);
  const domain = method.split(".")[0] ?? method;

  if (REFUSED_DOMAINS.includes(domain)) return refusalMessage(method);

  if (method === "Input.dispatchDragEvent") {
    const files = Option.flatMap(decodeDragData(params), (p) => Option.fromNullishOr(p.data.files));

    return Option.isSome(files) && files.value.length > 0
      ? "Input.dispatchDragEvent may not drop files here: they would come from the Desktop App's machine."
      : null;
  }

  if (method === "Browser.setDownloadBehavior" || method === "Page.setDownloadBehavior") {
    const decoded = decodeDownloadBehavior(params);

    const allowed =
      Option.isSome(decoded) &&
      (decoded.value.behavior === "deny" || decoded.value.behavior === "default") &&
      decoded.value.downloadPath === undefined;

    return allowed
      ? null
      : `${method} may only deny downloads here: the Desktop App chooses where they go.`;
  }

  return null;
};
