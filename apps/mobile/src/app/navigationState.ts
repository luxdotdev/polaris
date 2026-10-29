/** The navigation's state and its moves, pure, so the shell and its tests share them. */
import type { Route } from "./route.ts";

/** The tabs under the stack, in the pill's order; Hosts is a pushed screen, reached from Settings. */
export const HOME_TABS = ["sessions", "review", "settings"] as const;

export type HomeTab = (typeof HOME_TABS)[number];

export interface NewSessionSheet {
  readonly open: boolean;
  readonly workspaceId: string | null;
}

export interface NavigationState {
  readonly stack: ReadonlyArray<Route>;
  readonly tab: HomeTab;
  readonly newSession: NewSessionSheet;
}

const HOME: Route = { screen: "tabs" };

const CLOSED: NewSessionSheet = { open: false, workspaceId: null };

export const initialNavigation: NavigationState = {
  stack: [HOME],
  tab: "sessions",
  newSession: CLOSED,
};

export const topOf = (state: NavigationState): Route => state.stack.at(-1) ?? HOME;

export const pushed = (state: NavigationState, route: Route): NavigationState => ({
  ...state,
  stack: [...state.stack, route],
});

export const selected = (state: NavigationState, tab: HomeTab): NavigationState => ({
  ...state,
  tab,
});

export const wentBack = (state: NavigationState): NavigationState =>
  state.stack.length > 1 ? { ...state, stack: state.stack.slice(0, -1) } : state;

/** A link from outside the app lands on Home's Sessions, or on its route above it, sheet closed. */
export const opened = (state: NavigationState, route: Route): NavigationState => ({
  stack: route.screen === "tabs" ? [route] : [HOME, route],
  tab: "sessions",
  newSession: CLOSED,
});
