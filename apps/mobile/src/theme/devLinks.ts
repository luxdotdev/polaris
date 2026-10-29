/** Development builds only: `polaris://dev/theme/moonlit` and `…/motion/reduced` set Appearance. */
import { useEffect } from "react";
import { Linking } from "react-native";
import { type Appearance, devAppearanceLink } from "./appearance.ts";

export const useDevAppearanceLinks = (update: (change: Partial<Appearance>) => void): void => {
  useEffect(() => {
    if (!__DEV__) return;

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const change = devAppearanceLink(url);

      if (change !== null) update(change);
    });

    return () => subscription.remove();
  }, [update]);
};
