/**
 * The Browser on the Daemon's side (ENG-612): Host-address streams, Browser hosting and the
 * per-session CDP relay. Each service has a `layerStub` until its task lands.
 */
export { browserDefaults } from "./defaults.ts";

export { CdpRelay, type CdpEndpoint, type CdpRelayOptions, cdpRelayUrl } from "./cdpRelay.ts";

export { CdpRelayStore, CdpRelayStoreError, RememberedTab } from "./relayStore.ts";

export { BrowserHosting, BrowserStreamRefused } from "./hosting.ts";

export { HostAddressStreams, type HostAddressTarget } from "./hostAddressStreams.ts";
