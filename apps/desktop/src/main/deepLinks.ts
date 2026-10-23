/**
 * `polaris://` links from the OS (`open-url` on macOS, argv on Windows and Linux): parsed,
 * held until the renderer has loaded, then sent as a `deep-link` app event with the window brought forward.
 */
import type { AppEvent } from "../shared/api.ts";
import { type DeepLink, parseDeepLink } from "../shared/deepLink.ts";

export interface DeepLinkWindow {
  readonly send: (event: AppEvent) => void;
  readonly focus: () => void;
}

export interface DeepLinkInbox {
  readonly receive: (url: string) => void;
  /** The renderer is listening: the held link goes now, later ones straight away. */
  readonly attach: (window: DeepLinkWindow) => void;
}

/** Only the latest link is held: each one navigates, so earlier ones would be overtaken anyway. */
export const createDeepLinkInbox = (log: (line: string) => void): DeepLinkInbox => {
  let target: DeepLinkWindow | null = null;
  let held: DeepLink | null = null;

  const deliver = (window: DeepLinkWindow, link: DeepLink) => {
    window.focus();
    window.send({ kind: "deep-link", link });
  };

  return {
    receive: (url) => {
      const parsed = parseDeepLink(url);

      if ("ignored" in parsed) {
        log(`polaris: ignored a deep link (${parsed.ignored}): ${url.slice(0, 200)}`);

        return;
      }

      if (target === null) held = parsed.link;
      else deliver(target, parsed.link);
    },
    attach: (window) => {
      target = window;

      if (held === null) return;
      deliver(window, held);
      held = null;
    },
  };
};
