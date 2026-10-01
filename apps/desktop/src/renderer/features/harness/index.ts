/**
 * The Harness feature: which Harnesses a Host has (live availability, the
 * sign-in hand-off, the availability view), and the Harness and Model picker
 * every composer, the new-session page and Fork use. Polaris never installs one.
 */
export {
  refreshAvailability,
  useAvailability,
  useAvailabilityReports,
  useHarnessModels,
  useHarnessRunning,
  useRunningHarnesses,
  usePlanLimits,
} from "./live.ts";

export { limitAge } from "./model/limits.ts";

export {
  choose,
  defaultChoice,
  type ModelChange,
  modelChange,
  type ModelChoice,
  type ModelData,
  modelLabel,
  shortlist,
} from "./model/models.ts";

export {
  defaultHarness,
  type LastUsed,
  noneReady,
  reasonLine,
  type HarnessOption,
  listedOptions,
  olderThanTestedNote,
  STATUS_LABELS,
} from "./model/options.ts";

export {
  AvailabilityList,
  AvailabilitySheet,
  OtherHarnessesLink,
  SetupNote,
  useSignIn,
} from "./ui/Availability.tsx";

export { HarnessChip, type HarnessChipProps, NoHarnessChip } from "./ui/HarnessChip.tsx";

export { type HarnessChoice, HarnessChoiceRow } from "./ui/HarnessCards.tsx";
