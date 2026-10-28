/**
 * The app's deep links (scheme `polaris`, app.json): what the widgets open. `polaris://home`
 * opens Home; `polaris://session/<hostId>/<sessionId>` opens that agent session.
 */
import type { Route } from "../app/navigation.tsx";

export const HOME_LINK = "polaris://home";

export const sessionLink = (hostId: string, sessionId: string): string =>
  `polaris://session/${encodeURIComponent(hostId)}/${encodeURIComponent(sessionId)}`;

const decode = (part: string): string | null => {
  try {
    const value = decodeURIComponent(part);

    return value === "" ? null : value;
  } catch {
    return null;
  }
};

/** The route a link opens, or null when it isn't one of ours. Home is the tabs, `{ screen: "tabs" }`. */
export const routeOfLink = (url: string): Route | null => {
  const match = /^polaris:\/\/([^?#]*)/u.exec(url);

  if (match === null) return null;
  const parts = (match[1] ?? "").split("/").filter((part) => part !== "");
  const [kind, ...rest] = parts;

  if (kind === "home" && rest.length === 0) return { screen: "tabs" };

  if (kind !== "session" || rest.length !== 2) return null;
  const [hostId, sessionId] = rest.map(decode);

  return hostId == null || sessionId == null ? null : { screen: "thread", hostId, sessionId };
};
