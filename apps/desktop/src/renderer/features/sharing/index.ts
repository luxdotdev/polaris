/**
 * Shared Sessions in the Desktop App (ENG-941; DESIGN.md, Shared Sessions): Share and presence
 * in the session header, the share sheet, the people glyph and the sidebar's Shared with you.
 */
export {
  actorViewerOf,
  refreshSharedSessions,
  useActorViewer,
  useIsShared,
  useSharedView,
  useSharedWithMe,
} from "./data/feeds.ts";

export { HeaderShare, openShareSheet, useOnSharedHost, useSharedRole } from "./ui/HeaderShare.tsx";

export { SharedWithYou } from "./ui/SharedWithYou.tsx";

export { SharedTitle } from "./ui/SharedTitle.tsx";
