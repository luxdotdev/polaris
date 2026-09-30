/**
 * The first-run setup card's "connect a host" row (Paper 57Q-1), on
 * `@polaris/ui`'s SetupRow: same words and the same add-machine flow as
 * Settings → Hosts, on day 1 and day 60.
 */
import { Button, PixelTerminalIcon, SetupRow } from "@polaris/ui";
import { useShellActions } from "../../shell/hooks.ts";

export interface ConnectHostRowProps {
  /** Default: Settings → Hosts with the add-machine form open. */
  readonly onConnect?: () => void;
}

export const ConnectHostRow = ({ onConnect }: ConnectHostRowProps) => {
  const { openSettings } = useShellActions();

  return (
    <SetupRow
      icon={<PixelTerminalIcon />}
      title="Connect a host"
      caption="Optional. Any machine in ~/.ssh/config; Polaris asks before installing its daemon."
      action={
        <Button onClick={onConnect ?? (() => openSettings("hosts", { adding: true }))}>
          Add host
        </Button>
      }
    />
  );
};
