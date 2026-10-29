/** The navigation's state and its moves, pure, so the shell and its tests share them. */
import type { Route } from "./route.ts";

/** The tabs under the stack, in the pill's order; Hosts is a pushed screen, reached from Settings. */
export const HOME_TABS = ["sessions", "review", "settings"] as const;

export type HomeTab = (typeof HOME_TABS)[number];

export interface NavigationState {
  readonly stack: ReadonlyArray<Route>;
  readonly tab: HomeTab;
}

const HOME: Route = { screen: "tabs" };

export const initialNavigation: NavigationState = {
  stack: [HOME],
  tab: "sessions",
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

/** The top screen swapped for `route`: a new session becomes its thread once it starts. */
export const replaced = (state: NavigationState, route: Route): NavigationState => ({
  ...state,
  stack: state.stack.length > 1 ? [...state.stack.slice(0, -1), route] : [...state.stack, route],
});

export const wentBack = (state: NavigationState): NavigationState =>
  state.stack.length > 1 ? { ...state, stack: state.stack.slice(0, -1) } : state;

/** A link from outside the app lands on Home's Sessions, or on its route above it. */
export const opened = (state: NavigationState, route: Route): NavigationState => ({
  stack: route.screen === "tabs" ? [route] : [HOME, route],
  tab: "sessions",
});
