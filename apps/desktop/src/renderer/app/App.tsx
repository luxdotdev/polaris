/** The renderer root: providers around the shell. */
import { Toaster, TooltipProvider } from "@polaris/ui";
import { StrictMode } from "react";
import {
  type Onboarding,
  OnboardingProvider,
  settledOnboarding,
} from "../features/onboarding/index.ts";
import { type AppContextValue, AppProvider } from "../shell/hooks.ts";
import { NeedsYouPublisher } from "../features/needs-you/index.ts";
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
          <Toaster />
        </TooltipProvider>
      </OnboardingProvider>
    </AppProvider>
  </StrictMode>
);
