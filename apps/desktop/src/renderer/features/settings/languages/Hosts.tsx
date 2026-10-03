import { Button } from "@polaris/ui";
import { Match, Predicate } from "effect";
import { useState } from "react";
import type { LanguageHostView, LanguageSettingsAction, LanguageToolView } from "./contracts.ts";
import { Group, Heading } from "../ui/parts.tsx";
import { Field, FormBlock } from "./fields.tsx";
import { installationText, runtimeText, toolAction, trustMatchesCheckout } from "./toolState.ts";

const Tool = ({
  host,
  tool,
  busy,
  act,
}: {
  readonly host: LanguageHostView;
  readonly tool: LanguageToolView;
  readonly busy: boolean;
  readonly act: (action: LanguageSettingsAction) => void;
}) => {
  const action = toolAction(host, tool);
  const rollback = tool.actions.rollback;
  const logs = tool.actions.logs;

  const connected =
    host.connection === "Connected" &&
    host.capability === "available" &&
    host.id === tool.availability.hostId;

  return (
    <FormBlock>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-label text-text-strong break-words">{tool.name}</h3>
          <p className="text-caption text-text-subtle break-words">
            {installationText(tool)} · pinned {tool.availability.pinnedVersion}
          </p>
        </div>
        {action && (
          <Button disabled={busy} onClick={() => act(action.action)}>
            {action.label}
          </Button>
        )}
      </div>
      <p className="text-caption break-words">
        {runtimeText(tool)} · observed at {tool.availability.checkedAt}
      </p>
      {Predicate.isTagged(tool.availability.preflight, "Blocked") && (
        <p className="text-caption break-words">
          {tool.availability.preflight.reason} · {tool.availability.preflight.message}
        </p>
      )}
      {tool.availability.prerequisites.map((fact) => (
        <p key={fact.requirement.id} className="text-caption text-text-subtle break-words">
          {fact.requirement.executable} · {fact.requirement.version} · {fact.outcome} ·{" "}
          {fact.detectedVersion ?? "version not observed"} ·{" "}
          {fact.effectiveExecutable ?? "path not observed"} · {fact.reason}
        </p>
      ))}
      {tool.progress && (
        <div role="status" className="text-caption break-words">
          Observed {tool.progress.phase} · {tool.progress.downloadedBytes} /{" "}
          {tool.progress.totalBytes ?? "unknown"} bytes · {tool.progress.message}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {rollback && connected && Predicate.isTagged(tool.availability.preflight, "Eligible") && (
          <Button
            disabled={busy}
            onClick={() =>
              act({
                kind: "install",
                hostKey: host.key,
                toolId: tool.availability.toolId,
                version: rollback,
                intent: "rollback",
              })
            }
          >
            Roll back to {rollback}
          </Button>
        )}
        {logs && connected && logs.hostId === host.id && (
          <Button
            disabled={busy}
            variant="ghost"
            onClick={() => act({ kind: "logs", hostKey: host.key, context: logs })}
          >
            Open logs
          </Button>
        )}
      </div>
    </FormBlock>
  );
};

const Discovery = ({
  host,
  busy,
  act,
}: {
  readonly host: LanguageHostView;
  readonly busy: boolean;
  readonly act: (action: LanguageSettingsAction) => void;
}) => {
  const d = host.discovery;

  if (d === null)
    return (
      <FormBlock>
        <p className="text-caption text-text-subtle">
          Project roots, SDK and interpreter have not been observed on this host.
        </p>
      </FormBlock>
    );

  const explanation = Match.value(d.checkout).pipe(
    Match.tag(
      "Workspace",
      () => "Trust permits language tooling to execute project code in this workspace."
    ),
    Match.tag("Worktree", () => "This worktree inherits its workspace's trust."),
    Match.tag(
      "ReviewCheckout",
      () => "This review checkout needs its own explicit trust; workspace trust does not apply."
    ),
    Match.exhaustive
  );

  return (
    <FormBlock>
      <p className="text-caption break-all">
        Checkout: {d.checkout.path}
        <br />
        Project root: {d.projectRoot}
      </p>
      {d.providers.map((p) => (
        <div key={p.providerId} className="text-caption text-text-subtle break-all">
          {p.providerId} ·{" "}
          {p.launch ? (
            <>
              {p.launch.executable}
              <br />
              Working directory: {p.launch.workingDirectory}
              <br />
              SDK: {p.launch.sdk ?? "not observed"}
              <br />
              Interpreter: {p.launch.interpreter ?? "not observed"}
              <br />
              Plugin probe roots: {p.launch.pluginProbeRoots.join(", ") || "none"}
              <br />
              Environment names: {p.launch.environmentKeys.join(", ") || "none"}
            </>
          ) : (
            "launch path not observed"
          )}
          {Predicate.isTagged(p.preflight, "Blocked") && (
            <p>
              {p.preflight.reason} · {p.preflight.message}
            </p>
          )}
          {p.prerequisites.map((f) => (
            <p key={f.requirement.id}>
              {f.requirement.executable} · {f.outcome} · {f.reason}
            </p>
          ))}
        </div>
      ))}
      <p className="text-caption">{explanation} Syntax stays available.</p>
      <p className="text-caption">{d.trust.trusted ? "Trusted" : "Not trusted"}</p>
      <Button
        className="self-start"
        disabled={
          busy ||
          host.connection !== "Connected" ||
          host.capability !== "available" ||
          host.canSetTrust === false ||
          !trustMatchesCheckout(host)
        }
        onClick={() =>
          act({ kind: "trust", hostKey: host.key, trust: d.trust, trusted: !d.trust.trusted })
        }
      >
        {d.trust.trusted ? "Revoke trust" : "Trust this checkout"}
      </Button>
    </FormBlock>
  );
};

export const Hosts = ({
  hosts,
  busy,
  act,
}: {
  readonly hosts: ReadonlyArray<LanguageHostView>;
  readonly busy: boolean;
  readonly act: (action: LanguageSettingsAction) => void;
}) => {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(12);

  const filtered = hosts.filter((host) =>
    `${host.name} ${host.tools.map((t) => t.name).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <div className="gap-gap flex flex-col">
      <Heading>Language tools on hosts</Heading>
      <Field
        label="Find host or tool"
        value={query}
        onChange={(value) => {
          setQuery(value);
          setLimit(12);
        }}
      />
      {filtered.length === 0 && (
        <p className="text-caption text-text-subtle">
          No matching hosts. Add or connect a host in Host Settings.
        </p>
      )}
      {filtered.slice(0, limit).map((host) => (
        <Group key={host.key} label={host.name}>
          <FormBlock>
            <h2 className="text-heading-sm text-text-strong break-words">{host.name}</h2>
            <p className="text-caption">
              {host.connection} · {host.detail}
            </p>
            {host.capability === "unsupported" && (
              <p className="text-caption">
                Language tooling needs a newer daemon on {host.name}. Editing and syntax remain
                available.
              </p>
            )}
            {host.recovery && (
              <Button
                className="self-start"
                disabled={busy}
                onClick={() => {
                  const recovery = host.recovery;

                  if (recovery) act({ kind: "recover-host", hostKey: host.key, recovery });
                }}
              >
                {
                  {
                    reconnect: "Reconnect host",
                    upgrade: "Upgrade daemon",
                    attention: "Open host settings",
                  }[host.recovery]
                }
              </Button>
            )}
          </FormBlock>
          <div
            className={host.connection !== "Connected" ? "opacity-(--opacity-dimmed)" : undefined}
          >
            {host.tools.length === 0 && (
              <FormBlock>
                <p className="text-caption">No tool facts observed.</p>
              </FormBlock>
            )}
            {host.tools.slice(0, 32).map((tool) => (
              <Tool key={tool.availability.toolId} host={host} tool={tool} busy={busy} act={act} />
            ))}
            {host.tools.length > 32 && (
              <FormBlock>
                <p className="text-caption">
                  {host.tools.length - 32} more tools. Narrow the integration in the injected scope.
                </p>
              </FormBlock>
            )}
            <Discovery host={host} busy={busy} act={act} />
          </div>
        </Group>
      ))}
      {filtered.length > limit && (
        <Button onClick={() => setLimit(limit + 12)}>Show more hosts</Button>
      )}
    </div>
  );
};
