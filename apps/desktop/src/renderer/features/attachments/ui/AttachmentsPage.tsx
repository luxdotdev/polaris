/**
 * Settings → Attachments (DESIGN.md, Settings; ENG-180): per Host, when staged
 * attachments are deleted (a default and per-Workspace overrides), how much is
 * staged, and "Clear now". Each Host keeps its own settings.
 */
import type { AttachmentCleanup, Workspace, WorkspaceId } from "@polaris/protocol";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@polaris/ui";
import { useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { useApp } from "../../../shell/hooks.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import { sectionInfo } from "../../settings/model/sections.ts";
import {
  Column,
  FooterStrip,
  Group,
  Heading,
  PageHeader,
  SettingRow,
} from "../../settings/ui/parts.tsx";
import {
  amountLine,
  type CleanupSettings,
  filesLine,
  policyChoices,
  policyKey,
  policyLabel,
  policyOf,
  USE_DEFAULT,
  withDefault,
  withWorkspace,
} from "../cleanup.ts";
import { type CleanupState, useCleanup } from "../useCleanup.ts";

const CAPABILITY = "attachments.settings";

const PolicySelect = ({
  id,
  value,
  current,
  fallback,
  onChange,
}: {
  readonly id: string;
  readonly value: AttachmentCleanup | null;
  /** The policy in effect, to keep an unusual day count in the list. */
  readonly current: AttachmentCleanup;
  /** Set on Workspace rows: "Use default" follows it. */
  readonly fallback?: AttachmentCleanup;
  readonly onChange: (policy: AttachmentCleanup | null) => void;
}) => (
  <Select
    value={value === null ? USE_DEFAULT : policyKey(value)}
    onValueChange={(key) => onChange(key === USE_DEFAULT ? null : policyOf(key))}
  >
    <SelectTrigger id={id} className="h-tree-row min-w-56" data-testid={`cleanup-${id}`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {fallback === undefined ? null : (
        <SelectItem value={USE_DEFAULT}>Default · {policyLabel(fallback).toLowerCase()}</SelectItem>
      )}
      {policyChoices(current).map((p) => (
        <SelectItem key={policyKey(p)} value={policyKey(p)}>
          {policyLabel(p)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/** Two steps: the first press asks, the second clears. */
const ClearButton = ({
  label,
  onClear,
}: {
  readonly label: string;
  readonly onClear: () => Promise<void>;
}) => {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <Button variant="danger" onClick={() => setAsking(true)} data-testid="clear-attachments">
        Clear now
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="ghost" onClick={() => setAsking(false)} disabled={busy}>
        Cancel
      </Button>
      <Button
        variant="danger"
        disabled={busy}
        data-testid="confirm-clear"
        onClick={() => {
          setBusy(true);
          void onClear().finally(() => {
            setBusy(false);
            setAsking(false);
          });
        }}
      >
        {label}
      </Button>
    </span>
  );
};

const WorkspaceRow = ({
  workspace,
  settings,
  amount,
  onSave,
}: {
  readonly workspace: Workspace;
  readonly settings: CleanupSettings;
  readonly amount: { readonly bytes: number; readonly files: number } | undefined;
  readonly onSave: (settings: CleanupSettings) => void;
}) => {
  const override = settings.workspaces[workspace.id] ?? null;

  return (
    <SettingRow title={workspace.name} caption={amountLine(amount)} htmlFor={`ws-${workspace.id}`}>
      <PolicySelect
        id={`ws-${workspace.id}`}
        value={override}
        current={override ?? settings.default}
        fallback={settings.default}
        onChange={(p) => onSave(withWorkspace(settings, workspace.id, p))}
      />
    </SettingRow>
  );
};

const Unavailable = ({ line }: { readonly line: string }) => (
  <Group>
    <p className="px-panel text-caption text-text-subtle py-3">{line}</p>
  </Group>
);

const HostBody = ({
  host,
  state,
  workspaces,
  save,
  clear,
}: {
  readonly host: HostView;
  readonly state: CleanupState;
  readonly workspaces: ReadonlyArray<Workspace>;
  readonly save: (settings: CleanupSettings) => Promise<void>;
  readonly clear: (workspaceId: WorkspaceId | null) => Promise<void>;
}) => {
  if (state.kind === "loading") return <Unavailable line={`Asking ${host.label}…`} />;

  if (state.kind === "failed") return <Unavailable line={state.message} />;

  const { settings, usage } = state.data;
  const total = usage.total;

  return (
    <Group label={`Attachments on ${host.label}`}>
      <SettingRow
        title="Delete attachments"
        caption={`The default for every workspace on ${host.label}`}
        htmlFor={`default-${host.key}`}
      >
        <PolicySelect
          id={`default-${host.key}`}
          value={settings.default}
          current={settings.default}
          onChange={(p) => {
            if (p !== null) void save(withDefault(settings, p));
          }}
        />
      </SettingRow>
      {workspaces.map((w) => (
        <WorkspaceRow
          key={w.id}
          workspace={w}
          settings={settings}
          amount={usage.workspaces[w.id]}
          onSave={(next) => void save(next)}
        />
      ))}
      <FooterStrip>
        <span className="text-caption text-text-subtle tabular flex-1" data-testid="staged-total">
          {amountLine(total)} staged on {host.label}
        </span>
        {total.files === 0 ? null : (
          <ClearButton label={`Delete ${filesLine(total.files)}`} onClear={() => clear(null)} />
        )}
      </FooterStrip>
    </Group>
  );
};

const HostSection = ({ host }: { readonly host: HostView }) => {
  const connected = host.status.state === "connected";
  const supported = host.status.capabilities.includes(CAPABILITY);
  const { state, save, clear } = useCleanup(host.key, connected && supported);
  const model = useApp((s) => s.hostModels[host.key]) ?? emptyHostModel;

  const workspaces = [...model.workspaces.values()].sort((a, b) =>
    a.registeredAt.localeCompare(b.registeredAt)
  );

  return (
    <section className="flex flex-col gap-3" data-testid="attachments-host" data-host={host.key}>
      <Heading>{host.label}</Heading>
      {!connected ? (
        <Unavailable
          line={`${host.label} is ${host.status.state.replace("-", " ")}; its settings show once it's connected`}
        />
      ) : !supported ? (
        <Unavailable
          line={`The daemon on ${host.label} is too old to manage attachments; upgrade it from Hosts`}
        />
      ) : (
        <HostBody host={host} state={state} workspaces={workspaces} save={save} clear={clear} />
      )}
    </section>
  );
};

export const AttachmentsPage = () => {
  const hosts = useApp((s) => s.hosts);
  const info = sectionInfo("attachments");

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      {hosts.map((host) => (
        <HostSection key={host.key} host={host} />
      ))}
    </Column>
  );
};
