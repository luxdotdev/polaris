// Portions adapted from raycast/extensions@901f653 cursor-recent-projects/src/index.tsx (MIT)
/** Search Workspaces on every Host: start an Agent Session in one, or open it in Polaris. */
import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { existsSync } from "node:fs";
import { useState } from "react";
import { HostDropdown, hostFilterOf } from "./components/HostDropdown.tsx";
import { NewSessionForm } from "./components/NewSessionForm.tsx";
import { workspaceLink } from "./lib/links.ts";
import { type WorkspaceRow, workspaceRows } from "./lib/rows.ts";
import { usePolaris, withPolaris } from "./polaris.tsx";

const sessionsText = (count: number) =>
  count === 1 ? "1 agent session" : `${count} agent sessions`;

const WorkspaceItem = (props: { readonly row: WorkspaceRow; readonly local: boolean }) => {
  const { row } = props;
  const onThisMac = props.local && existsSync(row.workspace.path);

  return (
    <List.Item
      title={row.workspace.name}
      subtitle={row.workspace.path}
      icon={Icon.Folder}
      keywords={[row.hostName]}
      accessories={[
        ...(row.sessionCount === 0 ? [] : [{ text: sessionsText(row.sessionCount) }]),
        { text: row.hostName, icon: Icon.Network, tooltip: "Host" },
      ]}
      actions={
        <ActionPanel>
          <Action.Push
            title="New Agent Session"
            icon={Icon.Plus}
            target={<NewSessionForm workspace={row.key} />}
          />
          <Action.Open
            title="Open in Polaris"
            icon="icon.png"
            target={workspaceLink(row.hostId, row.workspace.id)}
            shortcut={Keyboard.Shortcut.Common.Open}
          />
          {onThisMac ? <Action.ShowInFinder path={row.workspace.path} /> : null}
          <Action.CopyToClipboard
            title="Copy Path"
            content={row.workspace.path}
            shortcut={Keyboard.Shortcut.Common.CopyPath}
          />
        </ActionPanel>
      }
    />
  );
};

const SearchWorkspaces = () => {
  const { views, localHosts } = usePolaris();
  const [host, setHost] = useState("all");
  const rows = workspaceRows(views, hostFilterOf(host, views));

  return (
    <List
      searchBarPlaceholder="Search workspaces"
      searchBarAccessory={
        views.length > 1 ? <HostDropdown views={views} onChange={setHost} /> : undefined
      }
    >
      <List.EmptyView title="No workspaces" description="Add a workspace in Polaris first." />
      {rows.map((row) => (
        <WorkspaceItem key={row.key} row={row} local={localHosts.has(row.hostId)} />
      ))}
    </List>
  );
};

export default withPolaris(SearchWorkspaces);
