/**
 * The composer's prompt (R6): a Lexical editor whose `/` menu lists the
 * session's Harness's Skills and Slash Commands (`harness.commands`) and
 * inserts each as a chip. The session feature mounts it in `DraftComposer`.
 */
export { Prompt, preloadPrompt } from "./ui/Prompt.tsx";

export type { PromptEditorProps } from "./ui/PromptEditor.tsx";

export { type CommandOption, promptFor } from "./model/commands.ts";

export { useHarnessCommands } from "./live.ts";

export { type CommandNotice, daemonNotice } from "./model/notice.ts";

export type { FrecencyTable } from "./model/frecency.ts";

export { type FrecencyScope, loadFrecency, recordFrecency, scopeKey } from "./frecencyStore.ts";

export { frecencyKey } from "./model/commands.ts";
