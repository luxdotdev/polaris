/** Opens what a widget was tapped for: the link that launched the app, then each one after. */
import { useEffect } from "react";
import { Linking } from "react-native";
import type { Navigation } from "../app/navigation.tsx";
import { routeOfLink } from "./links.ts";

export const useWidgetLinks = (open: Navigation["open"]): void => {
  useEffect(() => {
    const follow = (url: string | null | undefined) => {
      const route = url == null ? null : routeOfLink(url);

      if (route !== null) open(route);
    };

    void Linking.getInitialURL().then(follow);
    const subscription = Linking.addEventListener("url", ({ url }) => follow(url));

    return () => subscription.remove();
  }, [open]);
};
