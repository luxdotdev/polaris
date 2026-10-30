/**
 * A Workspace's Browser partition: persistent, so logins and cookies last across restarts,
 * and separate from the default session, so the renderer's CSP rewrite never reaches pages.
 */
import type { Session } from "electron";
import { chromiumVerdict } from "../tls/distrust.ts";
import { remoteProxyConfig } from "./bypass.ts";

/** One partition per Workspace on each Host. */
export const browserPartition = (hostKey: string, workspaceId: string) =>
  `persist:polaris-browser-${hostKey}-${workspaceId}`;

/**
 * The only permission a page gets: writing the clipboard from a click (a dev server's "copy"
 * buttons). Camera, microphone, location, notifications, MIDI, HID, USB, serial and the
 * rest are refused without a prompt.
 */
const GRANTED: ReadonlySet<string> = new Set(["clipboard-sanitized-write"]);

/** Where the partition's Host addresses go: this machine's loopback, or the SOCKS server. */
export type PartitionRoute =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly socksPort: number };

export const configurePartition = async (
  session: Session,
  route: PartitionRoute,
  isHostAddress: (hostname: string) => boolean
) => {
  await session.setProxy(
    route.kind === "local" ? { mode: "direct" } : remoteProxyConfig(route.socksPort)
  );
  // The pool may hold sockets from a proxy config this partition had before.
  await session.closeAllConnections();

  // A Host address's bytes never leave Polaris's link and the Host's loopback (ADR 0093).
  session.setCertificateVerifyProc((request, callback) =>
    callback(isHostAddress(request.hostname) ? 0 : chromiumVerdict(request))
  );
  session.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(GRANTED.has(permission))
  );
  session.setPermissionCheckHandler((_contents, permission) => GRANTED.has(permission));
  session.setDevicePermissionHandler(() => false);
};
