/**
 * Empty states in their three tiers (DESIGN.md, Empty states): stages with the
 * pixel scene (a Host with no workspaces, a Workspace with no sessions), panes
 * with a 48px tile, and inline caption lines (`SectionHeader`'s `empty`).
 */
export { HostStage } from "./ui/HostStage.tsx";

export { WorkspaceStage, type WorkspaceStageProps } from "./ui/WorkspaceStage.tsx";

export { LaterMode, NothingNeedsYou, type LaterModeProps } from "./ui/panes.tsx";
