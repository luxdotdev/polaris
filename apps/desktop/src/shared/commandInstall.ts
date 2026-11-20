/** The command is installed on this Client's machine, independently of connected Hosts. */
export type CommandLocation = "user" | "system";

export interface CommandInstallView {
  readonly supported: boolean;
  readonly available: boolean;
  readonly dismissed: boolean;
  readonly links: ReadonlyArray<{
    readonly location: CommandLocation;
    readonly path: string;
    readonly state: "absent" | "installed" | "conflict";
    readonly onPath: boolean;
  }>;
}
