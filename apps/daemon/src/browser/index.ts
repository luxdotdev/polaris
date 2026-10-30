/**
 * The Browser on the Daemon's side (ENG-612): Host-address streams, Browser hosting and the
 * per-session CDP relay. `transport/byteStreams.ts` serves the first two over the connection.
 */
export { browserDefaults } from "./defaults.ts";

export { CdpRelay, type CdpEndpoint, cdpRelayUrl } from "./cdpRelay.ts";

export {
  BROWSER_STREAM_ACCEPT_TIMEOUT,
  BrowserHosting,
  type BrowserHostingOptions,
  BrowserStreamRefused,
} from "./hosting.ts";

export {
  HostAddressStreams,
  type HostAddressTarget,
  type LoopbackConnector,
} from "./hostAddressStreams.ts";

export { ByteStreamQuota } from "./quota.ts";
