/**
 * Advanced → Markdown preview: external images per Workspace on the picked Host.
 * The preview can only allow; this is where a Workspace goes back to asking or blocks.
 */
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { useEffect, useId, useState } from "react";
import type { LanguageApi } from "../../../../shared/api.ts";
import { Group } from "../ui/parts.tsx";

export interface PolicyWorkspace {
  readonly id: P.WorkspaceId;
  readonly name: string;
}

const CHOICES = [
  ["ask", "Ask before loading"],
  ["allow", "Allow"],
  ["deny", "Block"],
] as const;

const WorkspaceImages = ({
  api,
  hostKey,
  hostId,
  workspace,
  onSaved,
}: {
  readonly api: LanguageApi;
  readonly hostKey: string;
  readonly hostId: P.HostId;
  readonly workspace: PolicyWorkspace;
  readonly onSaved: (workspaceId: P.WorkspaceId) => void;
}) => {
  const id = useId();
  const [policy, setPolicy] = useState<P.LanguagePreviewPolicy | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void api
      .request("languages.preview.policy.get", { hostKey, workspaceId: workspace.id })
      .then((reply) => {
        if (!live) return;

        if (!reply.ok) return setFailed(true);
        const valid = Schema.decodeUnknownSync(P.LanguagePreviewPolicy)(reply.value);

        if (valid.hostId === hostId && valid.workspaceId === workspace.id) setPolicy(valid);
        else setFailed(true);
      });

    return () => {
      live = false;
    };
  }, [api, hostKey, hostId, workspace.id]);

  const choose = async (value: string) => {
    if (policy === null) return;

    const externalImages = Schema.decodeUnknownSync(P.LanguagePreviewPolicy.fields.externalImages)(
      value
    );

    const reply = await api.request("languages.preview.policy.set", {
      hostKey,
      policy: P.LanguagePreviewPolicy.make({ ...policy, externalImages }),
    });

    if (!reply.ok) return setFailed(true);
    setPolicy(Schema.decodeUnknownSync(P.LanguagePreviewPolicy)(reply.value));
    setFailed(false);
    onSaved(workspace.id);
  };

  return (
    <div className="px-panel flex items-center gap-3 py-[calc(var(--spacing-gap)+2px)]">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="text-body text-text-strong font-medium">
          {workspace.name}
        </label>
        {failed && (
          <span role="status" className="text-caption text-text-subtle">
            Couldn't read or save this workspace's choice.
          </span>
        )}
      </span>
      <select
        id={id}
        value={policy?.externalImages ?? "ask"}
        disabled={policy === null}
        onChange={(event) => void choose(event.target.value)}
        className="border-hairline bg-bg rounded-control text-caption text-text-default h-7 shrink-0 border px-2"
      >
        {CHOICES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
};

export const MarkdownImages = ({
  api,
  hostKey,
  hostId,
  workspaces,
  onSaved,
}: {
  readonly api: LanguageApi;
  readonly hostKey: string;
  readonly hostId: P.HostId;
  readonly workspaces: ReadonlyArray<PolicyWorkspace>;
  readonly onSaved: (workspaceId: P.WorkspaceId) => void;
}) => (
  <Group label="External images in Markdown previews">
    <p className="px-panel text-caption text-text-subtle py-3">
      External images in Markdown previews, per workspace. Scripts never run.
    </p>
    {workspaces.length === 0 ? (
      <p className="px-panel text-caption text-text-subtle py-3">No workspaces on this host yet.</p>
    ) : (
      workspaces.map((workspace) => (
        <WorkspaceImages
          key={workspace.id}
          api={api}
          hostKey={hostKey}
          hostId={hostId}
          workspace={workspace}
          onSaved={onSaved}
        />
      ))
    )}
  </Group>
);
