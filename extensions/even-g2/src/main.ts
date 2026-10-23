// Portions adapted from even-realities/evenhub-templates@8cb01354 (MIT)
/** Starts the app in the Even app's WebView: the phone page and the glasses. */
import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";
import { createPolaris } from "@polaris/sdk";
import { startApp } from "./app/controller.ts";
import { evenGlasses } from "./glasses/bridge.ts";
import { mountPhonePage } from "./phone/page.ts";
import { addPairing, loadPairings, savePairings, type Stored } from "./phone/pairings.ts";
import { scanPairing } from "./phone/scan.ts";

const CLIENT_NAME = "Even G2";

const root = document.querySelector<HTMLElement>("#app");

if (root === null) throw new Error("index.html has no #app");

const bridge = await waitForEvenAppBridge();

const app = startApp({
  glasses: evenGlasses(bridge),
  connect: (pairings) => createPolaris({ pairings, clientName: CLIENT_NAME }),
  onHosts: (hosts) => phone.showHosts(hosts),
});

const texts = (stored: ReadonlyArray<Stored>) => stored.map((entry) => entry.text);

const initial = (): ReadonlyArray<Stored> => {
  const stored = loadPairings(localStorage);
  const dev = import.meta.env.DEV ? import.meta.env.VITE_POLARIS_PAIRING : undefined;

  if (stored.length > 0 || dev === undefined) return stored;
  const seeded = addPairing(stored, dev);

  return seeded.ok ? seeded.stored : stored;
};

const phone = mountPhonePage(root, {
  stored: initial(),
  onChange: (stored) => {
    savePairings(localStorage, stored);
    void app.pair(texts(stored));
  },
  scan: () => scanPairing(bridge),
});

void app.pair(texts(initial()));

// Sockets may be dropped while the WebView is in the background.
let hiddenAt: number | null = null;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") hiddenAt = Date.now();
  else if (hiddenAt !== null) {
    hiddenAt = null;
    void app.reconnect();
  }
});
