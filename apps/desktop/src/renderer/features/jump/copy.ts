/** The jump field's words, in the title bar and the menu: Review reaches pull requests, files and findings. */
export const jumpCopy = (mode: string) =>
  mode === "review"
    ? {
        placeholder: "Jump to a PR, file, or finding",
        hint: "Pull requests, files, findings, sessions",
        label: "Jump to a pull request, file, finding, session or action",
      }
    : {
        placeholder: "Jump to a session or workspace",
        hint: "Sessions, workspaces, hosts, actions",
        label: "Jump to a session, workspace, worktree, machine or action",
      };
