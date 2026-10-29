/** The Languages heading's host picker (Paper L4): a dot, the Host and a chevron; only connected Hosts can be picked. */
import {
  ChevronDownIcon,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@polaris/ui";
import type { HostView } from "../../../../shared/api.ts";
import { stateWords } from "../../../shell/hostCopy.ts";

export const pickable = (host: HostView) =>
  host.status.state === "connected" && host.status.host !== null;

const Dot = ({ on }: { readonly on: boolean }) => (
  <span
    aria-hidden
    className={cn(
      "size-1.5 shrink-0 rounded-full",
      on ? "bg-text-subtle" : "border-text-subtle border"
    )}
  />
);

export const HostPicker = ({
  hosts,
  value,
  onChange,
}: {
  readonly hosts: ReadonlyArray<HostView>;
  readonly value: string | null;
  readonly onChange: (hostKey: string) => void;
}) => {
  const current = hosts.find((h) => h.key === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Host: ${current?.label ?? "none"}`}
        className="bg-fill-selected rounded-control text-body text-text-default hover:bg-fill-selected/70 flex h-7 shrink-0 cursor-default items-center gap-1.5 px-2.5 font-medium"
      >
        <Dot on={current !== undefined && pickable(current)} />
        {current?.label ?? "No host"}
        <ChevronDownIcon size={10} className="text-text-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onChange}>
          {hosts.map((host) => (
            <DropdownMenuRadioItem key={host.key} value={host.key} disabled={!pickable(host)}>
              <span className="flex-1">{host.label}</span>
              {!pickable(host) && (
                <span className="text-caption text-text-subtle">
                  {stateWords(host.status.state) ?? "not connected"}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
