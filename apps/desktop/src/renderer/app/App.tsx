/** The renderer root: providers around the shell. */
import { Toaster, TooltipProvider } from "@polaris/ui";
import { StrictMode } from "react";
import {
  type Onboarding,
  OnboardingProvider,
  settledOnboarding,
} from "../features/onboarding/index.ts";
import { type AppContextValue, AppProvider } from "../shell/hooks.ts";
// Not the feature's index: it reaches slots.tsx, which must load after the shell's features.
import { UpgradeToasts } from "../features/machines/UpgradeToasts.tsx";
import { LinkedPullsPublisher } from "../features/accept/index.ts";
// The feeds module, not the feature index: the index pulls in the slots that this file renders.
import { ConstellationFeeds } from "../features/constellation/feeds.tsx";
import { NeedsYouPublisher } from "../features/needs-you/index.ts";
import { PullsPublisher } from "../features/pulls/index.ts";
// Not the feature's index: that loads the Review view's chunk.
import { CheckoutPublisher } from "../features/review/checkout/Publisher.tsx";
import { Shell } from "./Shell.tsx";

export interface AppProps {
  readonly value: AppContextValue;
  /** Absent in the fixture previews: the welcome already seen, no home fallback. */
  readonly onboarding?: Onboarding;
}

const settled = settledOnboarding();

export const App = ({ value, onboarding = settled }: AppProps) => (
  <StrictMode>
    <AppProvider value={value}>
      <OnboardingProvider value={onboarding}>
        <TooltipProvider>
          <Shell />
          <NeedsYouPublisher />
          <PullsPublisher />
          <CheckoutPublisher />
          <LinkedPullsPublisher />
          <ConstellationFeeds />
          <UpgradeToasts />
          <Toaster />
        </TooltipProvider>
      </OnboardingProvider>
    </AppProvider>
  </StrictMode>
);
