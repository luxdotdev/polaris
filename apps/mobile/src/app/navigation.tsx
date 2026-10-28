/**
 * The app's navigation: a stack of screens over the tabs (Sessions, Review), New as a sheet.
 * Screens push routes; the shell in App.tsx draws the top of the stack.
 */
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type Route =
  | { readonly screen: "tabs" }
  | { readonly screen: "hosts" }
  | { readonly screen: "thread"; readonly hostId: string; readonly sessionId: string }
  | { readonly screen: "constellation"; readonly hostId: string; readonly constellationId: string }
  | {
      readonly screen: "review";
      readonly hostId: string;
      readonly sessionId: string;
      readonly turnId: string | null;
    }
  | { readonly screen: "link" };

export interface Navigation {
  readonly top: Route;
  readonly push: (route: Route) => void;
  readonly back: () => void;
  /** The New agent session sheet; `workspaceId` preselects one. */
  readonly newSession: { readonly open: boolean; readonly workspaceId: string | null };
  readonly openNewSession: (workspaceId?: string) => void;
  readonly closeNewSession: () => void;
}

const NavigationContext = createContext<Navigation | null>(null);

export const NavigationProvider = ({ children }: { readonly children: ReactNode }) => {
  const [stack, setStack] = useState<ReadonlyArray<Route>>([{ screen: "tabs" }]);

  const [newSession, setNewSession] = useState<Navigation["newSession"]>({
    open: false,
    workspaceId: null,
  });

  const navigation = useMemo<Navigation>(
    () => ({
      top: stack.at(-1) ?? { screen: "tabs" },
      push: (route) => setStack((current) => [...current, route]),
      back: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
      newSession,
      openNewSession: (workspaceId) =>
        setNewSession({ open: true, workspaceId: workspaceId ?? null }),
      closeNewSession: () => setNewSession({ open: false, workspaceId: null }),
    }),
    [stack, newSession]
  );

  return <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>;
};

export const useNavigation = (): Navigation => {
  const navigation = useContext(NavigationContext);

  if (navigation === null) throw new Error("useNavigation needs a NavigationProvider above it");

  return navigation;
};
