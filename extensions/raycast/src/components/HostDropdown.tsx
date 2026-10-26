// Portions adapted from raycast/extensions@901f653 cursor-recent-projects/src/index.tsx (MIT)
/** The search bar's Host filter: every Host, or one; a Host that isn't Connected says how it stands. */
import { List } from "@raycast/api";
import type { HostView } from "@polaris/sdk";
import { CONNECTION_LABEL, connectionState } from "../lib/connection.ts";
import type { HostFilter } from "../lib/rows.ts";

const ALL = "all";

export const hostFilterOf = (value: string, views: ReadonlyArray<HostView>): HostFilter =>
  views.some((view) => view.hostId === value) ? value : null;

const titleOf = (view: HostView) => {
  const state = connectionState(view);

  return state === "connected" ? view.hostName : `${view.hostName} · ${CONNECTION_LABEL[state]}`;
};

export const HostDropdown = (props: {
  readonly views: ReadonlyArray<HostView>;
  readonly onChange: (value: string) => void;
}) => (
  <List.Dropdown tooltip="Host" storeValue defaultValue={ALL} onChange={props.onChange}>
    <List.Dropdown.Item title="All Hosts" value={ALL} />
    <List.Dropdown.Section>
      {props.views.map((view) => (
        <List.Dropdown.Item key={view.hostId} title={titleOf(view)} value={view.hostId} />
      ))}
    </List.Dropdown.Section>
  </List.Dropdown>
);
