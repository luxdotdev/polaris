import type { Appearance, SessionDefaults } from "./api.ts";
import type { SessionPrefs } from "./contract.ts";

export interface SettingsView extends Appearance {
  readonly keybindings: import("./keybindingOverrides.ts").KeybindingOverrides;
  readonly sessionDefaults: SessionDefaults;
  /** Settings → Sessions, defaults filled in. */
  readonly sessions: SessionPrefs;
  /** This build's version, for About Polaris. */
  readonly version: string;
  /** Polaris Dev: it holds a Developer Mode lease on each Host and never writes the setting. */
  readonly developmentBuild: boolean;
  /** False until the user pressed "Get started" on the welcome. */
  readonly welcomeSeen: boolean;
  readonly hosts: ReadonlyArray<{
    readonly alias: string;
    readonly label: string;
    readonly colour: string | null;
    readonly forwardAgent: boolean;
    /** Absent means ssh; "wsl" adds the distro named by `alias`. */
    readonly kind?: "ssh" | "wsl";
  }>;
}
