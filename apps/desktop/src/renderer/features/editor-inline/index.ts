/**
 * Inline chat (⌘I) and Add to agent session (⌘L) in the editor (spec §6): the selection bar,
 * the card with its inline diff, and the session picker.
 */
export { inlineExtensions, type InlineFile } from "./cm/index.ts";

export { type ActiveEditor, useInlineCommands } from "./install.ts";

export { InlineLayers } from "./ui/InlineLayers.tsx";

export { type Proposer, scriptedProposer, setProposer } from "./data/proposer.ts";
