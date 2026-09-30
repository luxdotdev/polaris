/** The renderer root: providers around the shell. */
import { Toaster, TooltipProvider } from "@polaris/ui";
import { StrictMode } from "react";
import { type AppContextValue, AppProvider } from "../shell/hooks.ts";
import { NeedsYouPublisher } from "../features/needs-you/index.ts";
import { Shell } from "./Shell.tsx";

export const App = ({ value }: { readonly value: AppContextValue }) => (
  <StrictMode>
    <AppProvider value={value}>
      <TooltipProvider>
        <Shell />
        <NeedsYouPublisher />
        <Toaster />
      </TooltipProvider>
    </AppProvider>
  </StrictMode>
);
