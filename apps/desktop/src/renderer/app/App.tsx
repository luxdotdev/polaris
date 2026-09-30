/** The renderer root: providers around the shell. */
import { Toaster, TooltipProvider } from "@polaris/ui";
import { StrictMode } from "react";
import { type Onboarding, OnboardingProvider } from "../features/onboarding/index.ts";
import { type AppContextValue, AppProvider } from "../shell/hooks.ts";
import { Shell } from "./Shell.tsx";

export interface AppProps {
  readonly value: AppContextValue;
  readonly onboarding: Onboarding;
}

export const App = ({ value, onboarding }: AppProps) => (
  <StrictMode>
    <AppProvider value={value}>
      <OnboardingProvider value={onboarding}>
        <TooltipProvider>
          <Shell />
          <Toaster />
        </TooltipProvider>
      </OnboardingProvider>
    </AppProvider>
  </StrictMode>
);
