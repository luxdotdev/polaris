/**
 * Installs M2-F into the Review view's slots: the Risk Summary column and its foot, and
 * "Submit review", with its critical pause, as a pull request's primary action. Imported for
 * its effect by the view.
 */
import { createElement } from "react";
import { SubmitReviewAction } from "../comments/index.ts";
import { fillPrimaryAction, fillReviewSlots, type ReviewSlotProps } from "../review/index.ts";
import { CriticalPause } from "./ui/CriticalPause.tsx";
import { RiskColumnSlot } from "./ui/RiskColumn.tsx";
import { RiskFooterSlot } from "./ui/RiskFooter.tsx";

fillReviewSlots({ RiskColumn: RiskColumnSlot, RiskFooter: RiskFooterSlot });

/** Submit review asks once while a Critical finding is open (Paper X-G). */
const SubmitWithPause = (props: ReviewSlotProps) =>
  createElement(SubmitReviewAction, { ...props, Pause: CriticalPause });

fillPrimaryAction("pull", SubmitWithPause);
