/**
 * Installs M2-F into the Review view's slots: the Risk Summary column and its foot, and
 * "Submit review" as a pull request's primary action. Imported for its effect by the view.
 */
import { SubmitReviewAction } from "../comments/index.ts";
import { fillPrimaryAction, fillReviewSlots } from "../review/index.ts";
import { RiskColumnSlot } from "./ui/RiskColumn.tsx";
import { RiskFooterSlot } from "./ui/RiskFooter.tsx";

fillReviewSlots({ RiskColumn: RiskColumnSlot, RiskFooter: RiskFooterSlot });

fillPrimaryAction("pull", SubmitReviewAction);
