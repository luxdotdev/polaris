/** Advanced (SR-02, Paper L4): custom servers, executable overrides and Markdown images, per Host. */
import * as P from "@polaris/protocol";
import { SettingsCard, SettingsWell } from "@polaris/ui";
import { useMemo } from "react";
import type { LanguageApi } from "../../../../shared/api.ts";
import { CustomServers } from "./CustomServers.tsx";
import { useRecord, type Committed } from "./hooks.ts";
import { MarkdownImages, type PolicyWorkspace } from "./MarkdownImages.tsx";
import { Overrides } from "./Overrides.tsx";
import { withKey } from "./records.ts";

export interface AdvancedHost {
  readonly key: string;
  readonly id: P.HostId;
  readonly label: string;
}

const Heading = ({ children }: { readonly children: string }) => (
  <h3 className="text-caption text-text-subtle px-0.5 font-medium">{children}</h3>
);

const Sections = ({
  api,
  host,
  providers,
  workspaces,
  committed,
  onPolicySaved,
}: {
  readonly api: LanguageApi;
  readonly host: AdvancedHost;
  readonly providers: ReadonlyArray<string>;
  readonly workspaces: ReadonlyArray<PolicyWorkspace>;
  readonly committed: Committed;
  readonly onPolicySaved: (workspaceId: P.WorkspaceId) => void;
}) => {
  const scope = useMemo(
    () => P.LanguageSettingsScope.cases.Host.make({ hostId: host.id }),
    [host.id]
  );

  const { record, failed, update } = useRecord(api, host.key, scope, committed);
  const disabled = record === null;

  return (
    <div className="flex flex-col gap-4">
      {failed && (
        <p role="status" className="text-caption text-text-subtle">
          Couldn't read or save {host.label}'s language settings. Try again.
        </p>
      )}
      <Heading>{`Custom language servers on ${host.label}`}</Heading>
      <CustomServers
        servers={record?.settings.customServers ?? []}
        disabled={disabled}
        onChange={(servers) =>
          void update(withKey("customServers", servers.length > 0 ? servers : undefined))
        }
      />
      <Heading>{`Executable overrides on ${host.label}`}</Heading>
      <Overrides
        overrides={record?.settings.executableOverrides ?? {}}
        providers={providers}
        disabled={disabled}
        onChange={(overrides) =>
          void update(
            withKey(
              "executableOverrides",
              Object.keys(overrides).length > 0 ? overrides : undefined
            )
          )
        }
      />
      <Heading>Markdown previews</Heading>
      <MarkdownImages
        api={api}
        hostKey={host.key}
        hostId={host.id}
        workspaces={workspaces}
        onSaved={onPolicySaved}
      />
    </div>
  );
};

/** Opened from the Languages card's Advanced… button, as its own card under it. */
export const Advanced = (props: {
  readonly api: LanguageApi | undefined;
  readonly host: AdvancedHost | null;
  readonly providers: ReadonlyArray<string>;
  readonly workspaces: ReadonlyArray<PolicyWorkspace>;
  readonly committed: Committed;
  readonly onPolicySaved: (workspaceId: P.WorkspaceId) => void;
}) => {
  const { api, host } = props;

  return (
    <SettingsCard
      aria-label="Advanced"
      title="Advanced"
      aside={host === null ? undefined : `Custom servers and overrides on ${host.label}`}
    >
      <SettingsWell rows={false} className="px-panel py-panel">
        {api && host ? (
          <Sections {...props} api={api} host={host} />
        ) : (
          <p className="text-caption text-text-subtle">
            Pick a connected host to change its language servers.
          </p>
        )}
      </SettingsWell>
    </SettingsCard>
  );
};
