/** Text scanners for submit-time checks: they find the first offending snippet, not every one. */

/** URL-bearing attributes, in markup and in markup strings built by script. */
const URL_ATTRIBUTE =
  /<[a-zA-Z][\w:-]*\b[^>]*?\s(src|href|srcset|action|formaction|poster|data|background|ping|cite|manifest|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/** A URL assigned to an element property or attribute from script. */
const SCRIPT_URL_ASSIGNMENT =
  /\.(?:src|href|srcset|action|poster)\s*=\s*["'`]\s*((?:[a-z][a-z\d+.-]*:|\/\/)[^"'`]*)|setAttribute\(\s*["'](?:src|href|srcset|action|poster|xlink:href)["']\s*,\s*["'`]\s*((?:[a-z][a-z\d+.-]*:|\/\/)[^"'`]*)/gi;

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

const CSS_IMPORT = /@import\b[^;]*/gi;

/** Network APIs CSP blocks: they fail silently in the frame. */
const NETWORK_API =
  /\b(?:fetch\s*\(|new\s+(?:WebSocket|EventSource|Worker|SharedWorker)\s*\(|XMLHttpRequest\b|(?:webkit)?RTCPeerConnection\b|RTCDataChannel\b|navigator\.sendBeacon\s*\(|importScripts\s*\(|\bimport\s*\(\s*["'`])/;

/** `data:`, `blob:` and `javascript:` stay in the frame; any other scheme, or `//`, leaves it. */
export const isExternalUrl = (raw: string): boolean => {
  const value = raw.trim().toLowerCase();

  if (value.startsWith("//")) return true;
  const scheme = /^([a-z][a-z\d+.-]*):/.exec(value)?.[1];

  return scheme !== undefined && !["data", "blob", "javascript"].includes(scheme);
};

/** srcset is a comma list of `url descriptor`; a data: URL's own commas never start a candidate. */
const srcsetUrls = (value: string): ReadonlyArray<string> =>
  value
    .split(/,\s+|,(?=\S+\s+\d)/)
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter((url) => url.length > 0);

const firstAttributeUrl = (html: string): string | undefined => {
  for (const match of html.matchAll(URL_ATTRIBUTE)) {
    const name = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    const urls = name === "srcset" ? srcsetUrls(value) : [value];
    const external = urls.find(isExternalUrl);

    if (external !== undefined) return `${name}="${external}"`;
  }

  return undefined;
};

const firstCssUrl = (html: string): string | undefined => {
  for (const match of html.matchAll(CSS_URL)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";

    if (isExternalUrl(value)) return `url(${value})`;
  }

  for (const match of html.matchAll(CSS_IMPORT)) {
    if (!/@import\s+(?:url\(\s*)?["']?\s*data:/i.test(match[0])) return match[0].trim();
  }

  return undefined;
};

const firstScriptUrl = (html: string): string | undefined => {
  for (const match of html.matchAll(SCRIPT_URL_ASSIGNMENT)) {
    const value = match[1] ?? match[2] ?? "";

    if (isExternalUrl(value)) return match[0].trim();
  }

  return NETWORK_API.exec(html)?.[0].trim();
};

/** The first snippet that would load or link to something outside the frame. */
export const findExternalUrl = (html: string): string | undefined =>
  firstAttributeUrl(html) ?? firstCssUrl(html) ?? firstScriptUrl(html);

const NAVIGATION = [
  /\blocation\s*\.\s*(?:assign|replace|reload)\s*\(/,
  /\blocation\s*\.\s*href\s*=(?!=)/,
  /\b(?:window|document|self|top|parent)\s*\.\s*location\s*=(?!=)/,
  /(?:^|[^.\w$])(?<!(?:let|const|var)\s+)location\s*=(?!=)/,
  /\bwindow\s*\.\s*open\s*\(/,
  /(?:^|[^.\w$])open\s*\(\s*["'`]/,
  /\b(?:top|parent)\s*\.\s*location\b/,
  /<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh/i,
  /<base\b/i,
  /\btarget\s*=\s*["']?_(?:top|parent)\b/i,
];

/** The first snippet that would navigate the frame or open a window. */
export const findNavigation = (html: string): string | undefined => {
  for (const pattern of NAVIGATION) {
    const match = pattern.exec(html);

    if (match !== null) return match[0].replace(/^[^\w<]+/, "").trim();
  }

  return undefined;
};

const VIEWPORT_UNIT = /(?<![\w.#-])\d*\.?\d+(?:vh|dvh|svh|lvh)\b/i;

const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g;

const FULL_HEIGHT = /(?:^|[;\s])(?:min-)?height\s*:\s*100%/i;

/** Whether a selector list styles `html`, `body` or `:root` itself, not a descendant. */
const stylesRoot = (selectors: string): boolean =>
  selectors.split(",").some((selector) => {
    const subject =
      selector
        .trim()
        .split(/[\s>+~]+/)
        .pop() ?? "";

    return /^(?:html|body|:root)(?=$|[.:#[])/i.test(subject);
  });

/** The first viewport unit, or a 100% height on `html`/`body`; both break the frame's sizing. */
export const findViewportSizing = (html: string): string | undefined => {
  const unit = VIEWPORT_UNIT.exec(html);

  if (unit !== null) return unit[0];

  for (const match of html.matchAll(CSS_RULE)) {
    // Keep only the selector: drop what precedes it in the same chunk (markup, an earlier rule).
    const selectors = (match[1] ?? "").replace(/^[\s\S]*(?:<[^>]*>|[;}])/, "");
    const height = FULL_HEIGHT.exec(match[2] ?? "");

    if (height !== null && stylesRoot(selectors)) {
      return `${selectors.trim()} { ${height[0].replace(/^[;\s]+/, "")} }`;
    }
  }

  return undefined;
};

const LEADING_DOCUMENT = /^(?:\s|<!--[\s\S]*?-->)*<\s*(!doctype|html|head|body)\b/i;

/** The document-level tag the fragment starts with, lowercased. */
export const findLeadingDocument = (html: string): string | undefined =>
  LEADING_DOCUMENT.exec(html)?.[1]?.toLowerCase();
