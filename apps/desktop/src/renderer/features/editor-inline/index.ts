/**
 * Inline chat (⌘I) and Add to agent session (⌘L) in the editor (spec §6): the selection bar,
 * the card with its inline diff, and the session picker. Only the lazy entry is exported, so
 * none of it (nor the editor) lands in the main bundle.
 */
export { LazyInline } from "./LazyInline.tsx";
