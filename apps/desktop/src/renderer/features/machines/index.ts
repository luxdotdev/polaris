/**
 * The machines feature: Settings → Hosts and the add-machine flow, mounted
 * in the shell's `SettingsHosts` slot (`src/renderer/app/slots.tsx`).
 */
export { HostsSettingsPage, type HostsSettingsPageProps } from "./HostsSettingsPage.tsx";

export { UpgradeToasts } from "./UpgradeToasts.tsx";

export { call as callMachines, useMachineInstall } from "./hooks.tsx";
