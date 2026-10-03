import * as P from "@polaris/protocol";
import { Button, PixelTerminalIcon, showToast } from "@polaris/ui";
import { Schema } from "effect";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { polaris } from "../../bridge.ts";
import { useApp, useConnection, useShellActions } from "../../../shell/hooks.ts";
import { createLanguageSettingsAdapter } from "./adapter.ts";
import { LanguageInstallFeedback } from "./feedback.ts";
import { Choice } from "./fields.tsx";
import { LanguageSettingsPage } from "./Page.tsx";
import { registeredCheckouts, registeredScopes } from "./registeredScopes.ts";
import { languageSettingsServices } from "./services.ts";
import { refreshMarkdownPolicy } from "../../editor/runtime/actions.ts";
import { MarkdownPolicy } from "./MarkdownPolicy.tsx";
import type {
  LanguageIntegrationOptions,
  OptionalLanguageActions,
} from "./integrationContracts.ts";

export const LanguageIntegrations = ({ onBack }: { readonly onBack: () => void }) => {
  const hosts = useApp((s) => s.hosts);
  const connection = useConnection();

  const membership = useApp(
    useShallow((s) =>
      Object.entries(s.hostModels).flatMap(([key, model]) => [
        key,
        model.workspaces,
        model.worktrees,
        model.reviewCheckouts,
      ])
    )
  );

  const actions = useShellActions();
  const services = useStore(languageSettingsServices);
  const [language, setLanguage] = useState<P.LanguageSyntaxId>("typescript");
  const [checkoutKey, setCheckoutKey] = useState("");
  const [dirty, setDirty] = useState(false);
  const api = polaris().languages;

  const feedback = useMemo(
    () =>
      new LanguageInstallFeedback((title, message) =>
        showToast({ source: "starlight", icon: <PixelTerminalIcon size={16} />, title, message })
      ),
    []
  );

  useEffect(() => () => feedback.dispose(), [feedback]);

  const checkouts = useMemo(
    () => registeredCheckouts(hosts, connection.store.getState().hostModels),
    [hosts, connection, membership]
  );

  const selected = checkouts.find((c) => c.key === checkoutKey) ?? null;

  const scopes = useMemo(
    () => registeredScopes(hosts, selected, language),
    [hosts, selected, language]
  );

  const adapter = useMemo(() => {
    const recover: LanguageIntegrationOptions["recover"] = async (action) => {
      if (action.recovery === "attention") {
        actions.openSettings("hosts");

        return { ok: true, value: undefined };
      }

      const result =
        action.recovery === "reconnect"
          ? await polaris().request("host.retryNow", { hostKey: action.hostKey })
          : await polaris().request("machines.updateDaemon", { hostKey: action.hostKey });

      return result.ok
        ? { ok: true, value: undefined }
        : { ok: false, message: "Couldn't recover host. Open Host Settings." };
    };

    const optional: OptionalLanguageActions = {};

    if (services.permissions) optional.permissions = services.permissions;

    if (services.logs) optional.logs = services.logs;

    if (services.refreshLanguageSettings)
      optional.refreshLanguageSettings = services.refreshLanguageSettings;

    return createLanguageSettingsAdapter({
      api,
      feedback,
      hosts,
      selected,
      checkouts,
      language,
      recover,
      ...optional,
    });
  }, [api, feedback, hosts, selected, checkouts, language, services, actions]);

  const host = hosts.find((h) => h.key === selected?.hostKey);
  const hostId = host?.status.host?.hostId;

  const hook = useMemo(
    () => ({ refreshMarkdownPolicy: services.refreshMarkdownPolicy ?? refreshMarkdownPolicy }),
    [services]
  );

  return (
    <>
      <div className="gap-gap pt-panel mx-auto flex w-[680px] max-w-[calc(100%-2rem)] flex-col">
        <Button variant="ghost" className="self-start" disabled={dirty} onClick={onBack}>
          Back to Editor settings
        </Button>
        <Choice
          label="Language"
          value={language}
          disabled={dirty}
          onChange={(value) => setLanguage(Schema.decodeUnknownSync(P.LanguageSyntaxId)(value))}
        >
          {P.LanguageSyntaxId.literals.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </Choice>
        <Choice
          label="Checkout for discovery and trust"
          value={selected?.key ?? ""}
          disabled={dirty}
          onChange={setCheckoutKey}
        >
          <option value="">Choose a registered checkout</option>
          {checkouts.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Choice>
        {hosts.some((h) => h.status.host === null) && (
          <p className="text-caption text-text-subtle">
            Some hosts have no confirmed identity. Connect them in Host Settings to inspect language
            tools.
          </p>
        )}
        {!api && (
          <p className="text-caption">
            Language settings need a newer Desktop App service. Editing and syntax remain available.
          </p>
        )}
      </div>
      <LanguageSettingsPage adapter={adapter} scopes={scopes} onDirty={setDirty} />
      {selected && hostId && (
        <div className="pb-panel mx-auto w-[680px] max-w-[calc(100%-2rem)]">
          <MarkdownPolicy
            api={api}
            authority={host?.status ?? services}
            selected={selected}
            hostId={hostId}
            hook={hook}
            disabled={
              dirty ||
              host?.status.state !== "connected" ||
              !host.status.capabilities.includes("languages.preview-media")
            }
          />
        </div>
      )}
    </>
  );
};
