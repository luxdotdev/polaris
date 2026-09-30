/** React access to onboarding: its state through selectors, and the home fallback. */
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { useApp } from "../../shell/hooks.ts";
import type { EnsureWorkspace } from "./ensureWorkspace.ts";
import { onboardingStage, type Stage } from "./model.ts";
import type { Onboarding, OnboardingState } from "./onboarding.ts";

const OnboardingContext = createContext<Onboarding | null>(null);

export const OnboardingProvider = OnboardingContext.Provider;

export const useOnboarding = (): Onboarding => {
  const value = useContext(OnboardingContext);

  if (value === null) throw new Error("used outside OnboardingProvider");

  return value;
};

export const useOnboardingState = <A>(select: (state: OnboardingState) => A): A =>
  useStore(useOnboarding().store, select);

/**
 * For the new-session page and anything else that needs a Workspace to act in:
 * the Host's first shown Workspace, or its home directory registered as "home".
 */
export const useEnsureWorkspace = (): EnsureWorkspace => useOnboarding().ensureWorkspace;

/** Which stage the app shows (model.ts, `onboardingStage`). */
export const useStage = (): Stage => {
  const welcome = useOnboardingState((s) => s.welcome);
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return onboardingStage({ welcome, hosts, models });
};
