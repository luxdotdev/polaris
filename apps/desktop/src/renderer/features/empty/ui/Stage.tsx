/**
 * The stage tier (DESIGN.md, Empty states): the pixel scene fills the main
 * area, a clearing holds the headline, and a raised setup card holds what to
 * do next. Laid out as the new-session page is (Paper VG-0, 57Q-1).
 */
import { Scene, StageHeading } from "@polaris/ui";
import type { ReactNode } from "react";

export interface StageProps {
  readonly kicker: string;
  readonly title: string;
  readonly line?: string;
  readonly children?: ReactNode;
  readonly testId?: string;
}

export const Stage = ({ kicker, title, line, children, testId }: StageProps) => (
  <Scene
    className="flex h-full min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-[120px] pb-10"
    data-testid={testId}
  >
    <StageHeading kicker={kicker} title={title} line={line} className="px-20 pb-[34px]" />
    {children}
  </Scene>
);
