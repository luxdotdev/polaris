/**
 * The WebView side of the zero-egress frame (ADR 0089): the tokens the app sends in, the theme
 * message it injects, and the navigation policy that lets only the document's own load through.
 */
import type { HostMessage } from "@polaris/visualization";
import type { MobileColours } from "../theme/index.ts";

/** Both phone themes are dark. */
export const FRAME_SCHEME = "dark";

/** The kit's tokens from the app's theme (DESIGN.md, Visualizations → the kit, V9). */
export const frameTokens = (colours: MobileColours) => ({
  "--pv-bg": colours.panel,
  "--pv-surface": colours.well,
  "--pv-raised": colours.raised,
  "--pv-border": colours.hairline,
  "--pv-text-strong": colours.textStrong,
  "--pv-text": colours.textDefault,
  "--pv-text-subtle": colours.textSubtle,
  "--pv-text-faint": colours.textFaint,
  "--pv-accent": colours.contextTools,
  "--pv-focus": colours.starlight,
  "--pv-series-1": colours.contextTools,
  "--pv-series-2": colours.contextSystem,
  "--pv-series-3": colours.contextMcp,
  "--pv-series-4": colours.contextSkills,
  "--pv-series-5": colours.contextMemory,
});

/** Script that hands a message to the frame's kit as a `message` event with no source. */
export const hostMessageScript = (message: HostMessage): string =>
  `window.dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(message)} }));true;`;

export interface LoadRequest {
  readonly url: string;
}

/**
 * The frame's navigation policy: its own document (`about:blank`, the HTML string's URL) may load
 * until it has loaded once; every other request, and any later one, is refused.
 */
export const navigationPolicy = () => {
  let loaded = false;
  let refused = false;

  return {
    shouldStart: ({ url }: LoadRequest): boolean => {
      if (!loaded && url === "about:blank") return true;
      refused = true;

      return false;
    },
    loaded: () => {
      loaded = true;
    },
    /** True once the frame tried to go anywhere else. */
    get refused() {
      return refused;
    },
  };
};
