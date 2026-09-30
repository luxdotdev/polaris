/**
 * Onboarding (DESIGN.md, Onboarding): O1 Welcome, the O2 setup stage the
 * Orchestrator shows while no Host has a Workspace, and the home-directory
 * fallback every new-session entry point uses.
 */
export { createEnsureWorkspace, type Ensured, type EnsureWorkspace } from "./ensureWorkspace.ts";

export {
  OnboardingProvider,
  useEnsureWorkspace,
  useOnboarding,
  useOnboardingState,
  useStage,
} from "./hooks.ts";

export type { Stage, Welcome as WelcomeState } from "./model.ts";

export { createOnboarding, type Onboarding, settledOnboarding } from "./onboarding.ts";

export { SetupStage, type SetupStageProps, WaitingStage } from "./ui/SetupStage.tsx";

export { Welcome } from "./ui/Welcome.tsx";
