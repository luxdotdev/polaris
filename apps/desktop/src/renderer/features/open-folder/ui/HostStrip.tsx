/** The dialog's Host choice: every Host, with its Connection State in words when not connected. */
import { SegmentedControl } from "@polaris/ui";
import type { HostView } from "../../../../shared/api.ts";
import { stateWords } from "../../../shell/hostCopy.ts";

const Label = ({ host }: { readonly host: HostView }) => {
  const state = stateWords(host.status.state);

  return (
    <span data-host={host.key} data-connection={host.status.state}>
      {host.label}
      {state === null ? null : <span className="text-text-subtle font-regular"> · {state}</span>}
    </span>
  );
};

export interface HostStripProps {
  readonly hosts: ReadonlyArray<HostView>;
  readonly value: string;
  readonly onChange: (hostKey: string) => void;
}

export const HostStrip = ({ hosts, value, onChange }: HostStripProps) => (
  <div className="border-hairline flex h-11 shrink-0 items-center gap-3 border-b px-4">
    <span className="text-caption text-text-subtle shrink-0">Open a folder on</span>
    <SegmentedControl
      aria-label="Host"
      className="min-w-0 [scrollbar-width:none] overflow-x-auto"
      options={hosts.map((h) => ({ value: h.key, label: <Label host={h} /> }))}
      value={value}
      onValueChange={onChange}
    />
  </div>
);
