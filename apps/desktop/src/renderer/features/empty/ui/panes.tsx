/**
 * Pane-tier empty states (Paper 5SH-1): a 48px Starlight-washed tile, one
 * sentence, one fact, at most one action; never a signal colour. The inbox's
 * own ("Nothing needs you") lives with the needs-you feature.
 */
import { EmptyState, PixelSparkleIcon } from "@polaris/ui";

const glyph = "text-text-strong";

export interface LaterModeProps {
  readonly title: string;
  readonly fact: string;
}

/** Review and Edit before their milestones: say so plainly, and how to get back. */
export const LaterMode = ({ title, fact }: LaterModeProps) => (
  <div className="grid flex-1 place-items-center">
    <EmptyState icon={<PixelSparkleIcon size={24} className={glyph} />} title={title} fact={fact} />
  </div>
);
