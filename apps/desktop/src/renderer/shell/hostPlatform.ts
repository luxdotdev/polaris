/**
 * What a Host's own OS rules out, from its `hello` (`HostInfo.platform`). Windows Hosts have
 * no language tools or secret scanning until 0.3.0 (ENG-296); copy names the Host's OS.
 */
import type { HostView } from "../../shared/api.ts";

/** A Host running the native Windows Daemon (`windows-x64`); not a WSL distro. */
export const isWindowsHost = (host: Pick<HostView, "status"> | undefined): boolean =>
  host?.status.host?.platform.startsWith("windows") === true;

export const LANGUAGES_OFF_ON_WINDOWS =
  "Language tools aren't available on Windows hosts yet. Highlighting works.";

/** The language panel's fact for a Host the editor can't use language tools on. */
export const noToolingFact = (host: Pick<HostView, "status"> | undefined): string =>
  host?.status.state === "connected" && isWindowsHost(host)
    ? LANGUAGES_OFF_ON_WINDOWS
    : "Language tooling is unavailable on this Host. Local syntax remains available.";

/** Stands in for the rules layer's Betterleaks note, joined with ". " like the others. */
export const SECRETS_OFF_ON_WINDOWS = "Secrets aren't scanned on Windows hosts yet";
