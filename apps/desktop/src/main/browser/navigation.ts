/**
 * What a Browser tab may load: http, https and about:blank, nothing else (no file:, javascript:,
 * data:, chrome:, devtools: or the app's own origin). The same check guards the URL bar, agent
 * and page navigations, redirects and popups.
 */

const SCHEMES = new Set(["http:", "https:"]);

const BLANK = "about:blank";

const parse = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/** True when a tab may navigate to `url`. */
export const allowedUrl = (url: string): boolean => {
  if (url === BLANK) return true;

  const parsed = parse(url);

  return parsed !== null && SCHEMES.has(parsed.protocol) && parsed.hostname !== "";
};

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

/**
 * A loopback name, which in a Browser always means the Agent Session's Host (CONTEXT.md, Host
 * address): localhost, any `*.localhost`, 127.0.0.0/8 and ::1.
 */
export const isHostAddressName = (hostname: string): boolean => {
  const name = hostname.toLowerCase().replace(/\.$/, "");

  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    LOOPBACK_V4.test(name) ||
    name === "[::1]" ||
    name === "::1"
  );
};

/** True when `url` is a Host address: the URL bar shows the badge instead of the padlock. */
export const isHostAddress = (url: string): boolean => {
  const parsed = parse(url);

  return parsed !== null && SCHEMES.has(parsed.protocol) && isHostAddressName(parsed.hostname);
};

/** A scheme, as opposed to `localhost:3000`'s port. */
const SCHEME = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i;

/**
 * What the user typed in the URL bar (or an agent asked for) as a URL to load, or null when it
 * isn't one a tab may load. A bare name gets http for a Host address, https otherwise.
 */
export const urlFromInput = (input: string): string | null => {
  const text = input.trim();

  if (text === "" || /\s/.test(text)) return null;

  if (SCHEME.test(text)) {
    if (text.toLowerCase() === BLANK) return BLANK;

    return allowedUrl(text) ? (parse(text)?.href ?? null) : null;
  }

  const host = text.split(/[/?#]/, 1)[0] ?? "";
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  const candidate = `${isHostAddressName(hostname ?? "") ? "http" : "https"}://${text}`;

  return allowedUrl(candidate) ? (parse(candidate)?.href ?? null) : null;
};
