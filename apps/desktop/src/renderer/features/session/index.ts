/**
 * The session feature: the Orchestrator's Intent (conversation and composer)
 * and Output (the Turn's diff) for one Agent Session, and the new-session
 * page. The shell places them; selection stays with the shell.
 */
export { NewSessionPage, type NewSessionPageProps } from "./ui/NewSessionPage.tsx";

export { SessionIntent, type SessionViewProps } from "./ui/SessionIntent.tsx";

export { SessionOutput, type SessionOutputProps } from "./ui/SessionOutput.tsx";

export { OutputRail } from "./output/OutputRail.tsx";

export {
  hideOutput,
  offerOutput,
  showOutput,
  toggleOutput,
  useOutputShown,
} from "./output/actions.ts";

export { clampWidth, defaultWidth, KEY_STEP, RAIL_WIDTH, widthCss } from "./output/layout.ts";

export { useFilesTick } from "./output/watch.ts";

export { setOutputWidth, useOutputWidth } from "./output/width.ts";

export { SessionChromeContext, type PolarisCardArgs, type SessionChrome } from "./chrome.ts";

export { updateDraft } from "./state.ts";
