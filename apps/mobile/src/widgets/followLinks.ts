/** Sends each widget link to navigation: the one that launched the app, then each one after. */
import type { Route } from "../app/route.ts";
import { routeOfLink } from "./links.ts";

/** The part of React Native's Linking this needs. */
export interface LinkSource {
  readonly getInitialURL: () => Promise<string | null | undefined>;
  readonly addEventListener: (
    type: "url",
    listener: (event: { url: string }) => void
  ) => { remove: () => void };
}

/** Follows the links; the returned function stops listening. */
export const followWidgetLinks = (
  links: LinkSource,
  open: (route: Route) => void
): (() => void) => {
  const follow = (url: string | null | undefined) => {
    const route = url == null ? null : routeOfLink(url);

    if (route !== null) open(route);
  };

  void links.getInitialURL().then(follow);
  const subscription = links.addEventListener("url", ({ url }) => follow(url));

  return () => subscription.remove();
};
