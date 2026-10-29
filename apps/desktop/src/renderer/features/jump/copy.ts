/** The jump field's words, in the title bar and the menu: Review reaches pull requests, files and findings. */
export const jumpCopy = (mode: string) =>
  mode === "review"
    ? {
        placeholder: "Jump to a PR, file, or finding",
        label: "Jump to a pull request, file, finding or session",
      }
    : {
        placeholder: "Jump to a session or workspace",
        label: "Jump to a session, workspace, worktree or machine",
      };
