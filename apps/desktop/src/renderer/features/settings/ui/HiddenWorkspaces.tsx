/**
 * Settings → Sessions → Hidden workspaces (DESIGN.md, Settings; ENG-566): every hidden workspace
 * with a destructive Remove that confirms in place, naming what goes with it (docs/adr/0086).
 */
import { Button } from "@polaris/ui";
import { useMemo, useState } from "react";
import { useApp } from "../../../shell/hooks.ts";
import {
  type HiddenWorkspaceRow,
  hiddenWorkspaceRows,
  removalBlocked,
  removalConsequence,
  rowCaption,
} from "../model/hiddenWorkspaces.ts";
import { removeWorkspace } from "../removeWorkspace.ts";
import { Group, Heading } from "./parts.tsx";

const Row = ({
  row,
  onRemove,
}: {
  readonly row: HiddenWorkspaceRow;
  readonly onRemove: (row: HiddenWorkspaceRow) => Promise<boolean>;
}) => {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = removalBlocked(row);

  const caption = asking ? removalConsequence(row) : (blocked ?? rowCaption(row));

  return (
    <div
      className="px-panel flex items-center gap-4 py-[calc(var(--spacing-gap)+4px)]"
      data-testid="hidden-workspace"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label font-regular text-text-default truncate" title={row.path}>
          {row.name}
        </span>
        <span className="text-caption text-text-subtle" data-testid="hidden-workspace-caption">
          {caption}
        </span>
      </div>
      {asking ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" autoFocus disabled={busy} onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || blocked !== null}
            data-testid="confirm-remove-workspace"
            onClick={() => {
              setBusy(true);
              void onRemove(row).then((removed) => {
                if (removed) return;
                setBusy(false);
                setAsking(false);
              });
            }}
          >
            Remove {row.name}
          </Button>
        </div>
      ) : (
        <Button
          variant="danger"
          className="shrink-0"
          disabled={blocked !== null}
          data-testid="remove-workspace"
          onClick={() => setAsking(true)}
        >
          Remove workspace…
        </Button>
      )}
    </div>
  );
};

export const HiddenWorkspaces = ({
  remove = (row: HiddenWorkspaceRow) => removeWorkspace(row.hostKey, row.workspaceId),
}: {
  /** Sends the removal; tests and the preview pass their own. */
  readonly remove?: (row: HiddenWorkspaceRow) => Promise<boolean>;
}) => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const constellations = useApp((s) => s.constellations);

  const rows = useMemo(
    () => hiddenWorkspaceRows(hosts, models, constellations),
    [hosts, models, constellations]
  );

  return (
    <section aria-label="Hidden workspaces" className="flex flex-col gap-3">
      <Heading>Hidden workspaces</Heading>
      <Group>
        {rows.length === 0 ? (
          <p className="px-panel text-caption text-text-subtle py-3">No hidden workspaces</p>
        ) : (
          rows.map((row) => <Row key={row.key} row={row} onRemove={remove} />)
        )}
      </Group>
    </section>
  );
};
