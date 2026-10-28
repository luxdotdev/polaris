/**
 * The app's navigation: a stack of screens over the tabs (Sessions, Review), New as a sheet.
 * Screens push routes; the shell in App.tsx draws the top of the stack.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export type Route =
  | { readonly screen: "tabs" }
  | { readonly screen: "hosts" }
  | { readonly screen: "thread"; readonly hostId: string; readonly sessionId: string }
  | { readonly screen: "constellation"; readonly hostId: string; readonly constellationId: string }
  | { readonly screen: "link" };

/** The tabs under the stack; Hosts is a pushed screen, not one of them. */
export type HomeTab = "sessions" | "review";

export interface Navigation {
  readonly top: Route;
  readonly tab: HomeTab;
  readonly selectTab: (tab: HomeTab) => void;
  readonly push: (route: Route) => void;
  readonly back: () => void;
  /** Opens a route from outside the app (a widget's link): Home, or the route on top of it. */
  readonly open: (route: Route) => void;
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

  const [tab, selectTab] = useState<HomeTab>("sessions");

  const open = useCallback((route: Route) => {
    setNewSession({ open: false, workspaceId: null });

    if (route.screen === "tabs") selectTab("sessions");
    setStack(route.screen === "tabs" ? [route] : [{ screen: "tabs" }, route]);
  }, []);

  const navigation = useMemo<Navigation>(
    () => ({
      top: stack.at(-1) ?? { screen: "tabs" },
      tab,
      selectTab,
      push: (route) => setStack((current) => [...current, route]),
      back: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
      open,
      newSession,
      openNewSession: (workspaceId) =>
        setNewSession({ open: true, workspaceId: workspaceId ?? null }),
      closeNewSession: () => setNewSession({ open: false, workspaceId: null }),
    }),
    [stack, newSession, tab, open]
  );

  return <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>;
};

export const useNavigation = (): Navigation => {
  const navigation = useContext(NavigationContext);

  if (navigation === null) throw new Error("useNavigation needs a NavigationProvider above it");

  return navigation;
};
