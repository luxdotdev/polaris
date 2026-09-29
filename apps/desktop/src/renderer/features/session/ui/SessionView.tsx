/**
 * Intent and Output side by side, as artboard 5 lays them out (448px Intent,
 * Output taking the rest). A stand-in until the shell (A1) places them itself.
 */
import { SessionIntent, type SessionViewProps } from "./SessionIntent.tsx";
import { SessionOutput } from "./SessionOutput.tsx";

export const SessionView = (props: SessionViewProps) => (
  <div className="flex h-full min-h-0 min-w-0 flex-1">
    <div className="border-hairline flex w-[448px] shrink-0 flex-col border-r">
      <SessionIntent {...props} />
    </div>
    <div className="flex min-w-0 flex-1 flex-col">
      <SessionOutput {...props} />
    </div>
  </div>
);
