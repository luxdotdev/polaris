/** Settings → Hosts until features/machines fills the `SettingsHosts` slot. */
import { Column, PageHeader } from "./parts.tsx";

export const HostsPlaceholder = () => (
  <Column>
    <PageHeader title="Hosts" blurb="Hosts are listed in settings.json for now." />
  </Column>
);
