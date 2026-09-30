/**
 * The first-run setup card's "connect a host" row (Paper 57Q-1): same words
 * and the same add-machine flow as Settings → Hosts, on day 1 and day 60.
 * Mirrors `@polaris/ui`'s SetupRow on `desk/ui-fixes` until it lands on main.
 */
import { Button, PixelTerminalIcon, Tile } from "@polaris/ui";

export interface ConnectHostRowProps {
  /** Opens Settings → Hosts with the add-machine flow open (`HostsSettingsPage adding`). */
  readonly onConnect: () => void;
}

export const ConnectHostRow = ({ onConnect }: ConnectHostRowProps) => (
  <div data-slot="setup-row" className="flex items-center gap-3.5 px-4 py-3.5">
    <Tile hue="starlight" size={40} className="text-text-strong border-transparent">
      <PixelTerminalIcon />
    </Tile>
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p className="text-heading-sm text-text-strong">Connect a host</p>
      <p className="text-caption text-text-subtle truncate">
        Optional. Any machine in ~/.ssh/config; Polaris asks before installing its daemon.
      </p>
    </div>
    <Button onClick={onConnect}>Add host</Button>
  </div>
);
