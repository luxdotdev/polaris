import { useEffect, useState } from "react";
import { Option, Schema } from "effect";
import { Button, Input, Switch } from "@polaris/ui";
import type { HostView } from "../../../../shared/api.ts";
import {
  ConfiguredPredictionEndpoint,
  type PredictionClientEndpoints,
} from "../../../../shared/predictionPlacement.ts";
import { commandShortcut } from "../../../../shared/keymap.ts";
import { polaris } from "../../bridge.ts";
import { Heading, SettingRow } from "../ui/parts.tsx";
import {
  hostConnected,
  inspectPredictionHost,
  loadPredictionSettings,
  modelName,
  preferencesOf,
  setClientEndpoints,
  setPredictionEnabled,
  setPredictionPreferences,
  usePrediction,
} from "../../editor/prediction/store.ts";

const CONTROL =
  "bg-surface-sunken border-hairline rounded-control text-body text-text-default h-row min-w-0 border px-row-pad";

const CHOICES = [
  { value: "auto", label: "Auto" },
  { value: "client", label: "This machine" },
  { value: "host", label: "Host" },
  { value: "off", label: "Off" },
] as const;

const Placement = Schema.Literals(["auto", "client", "host", "off"]);

const EndpointForm = ({
  endpoints,
  save,
  machine,
}: {
  readonly endpoints: PredictionClientEndpoints;
  readonly save: (endpoints: PredictionClientEndpoints) => Promise<void>;
  readonly machine: string;
}) => {
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState("openai");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = () => {
    const endpoint = Schema.decodeUnknownOption(ConfiguredPredictionEndpoint)({
      kind,
      url: url.trim(),
    });

    if (Option.isNone(endpoint)) {
      setError("Use localhost or a private IP address, without credentials, query or fragment.");

      return;
    }

    setSaving(true);
    setError(null);

    void save([
      ...endpoints.filter((item) => item.url !== endpoint.value.url),
      endpoint.value,
    ]).then(
      () => {
        setUrl("");
        setSaving(false);
      },
      (cause) => {
        setError(String(cause));
        setSaving(false);
      }
    );
  };

  const remove = (at: number) =>
    save(endpoints.filter((_value, index) => index !== at)).catch((cause) =>
      setError(String(cause))
    );

  return (
    <div className="gap-gap flex flex-col">
      {endpoints.map((endpoint, at) => (
        <div key={`${endpoint.kind}:${endpoint.url}`} className="flex min-w-0 items-center gap-3">
          <span
            className="text-caption text-text-subtle min-w-0 flex-1 truncate font-mono"
            title={endpoint.url}
          >
            {endpoint.url}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void remove(at)}
            aria-label={`Remove ${endpoint.url} on ${machine}`}
          >
            Remove
          </Button>
        </div>
      ))}
      <form
        className="gap-gap flex flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="text-caption text-text-subtle flex items-center gap-4">
          Server
          <select
            aria-label={`Model server kind on ${machine}`}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className={`${CONTROL} flex-1`}
          >
            <option value="openai">llama-server / LM Studio</option>
            <option value="ollama">Ollama</option>
          </select>
        </label>
        <label className="text-caption text-text-subtle gap-gap flex flex-col">
          Endpoint URL on {machine}
          <Input
            value={url}
            maxLength={2048}
            spellCheck={false}
            className="font-mono"
            placeholder="http://127.0.0.1:8080"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            type="submit"
            disabled={saving || url.trim().length === 0 || endpoints.length >= 16}
          >
            Add endpoint
          </Button>
        </div>
      </form>
      {error && (
        <p role="status" className="text-caption text-text-subtle">
          {error}
        </p>
      )}
    </div>
  );
};

export const TabCompletion = ({ hosts }: { readonly hosts: ReadonlyArray<HostView> }) => {
  const state = usePrediction((value) => value);
  const [scope, setScope] = useState("client");
  const [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState<number | null>(null);

  const keys = hosts.map((host) => host.key).join("\u0000");
  const epochs = hosts.map((host) => host.status.epoch).join("\u0000");

  useEffect(() => {
    const api = polaris();
    let live = true;

    void loadPredictionSettings(api).catch((cause) => live && setError(String(cause)));

    for (const hostKey of keys.split("\u0000").filter(Boolean))
      void inspectPredictionHost(api, hostKey, true).catch(
        (cause) => live && setError(String(cause))
      );
    void api.request("prediction.resources.get", {}).then((result) => {
      if (live && result.ok) setMemory(result.value.rssBytes);
    });

    return () => {
      live = false;
    };
  }, [keys, epochs]);

  const clientLabel =
    Object.values(state.inspections)[0]?.clientLabel ??
    hosts.find((host) => host.alias === null)?.label ??
    "Client device";

  const scopeHost = hosts.find((host) => host.key === scope);
  const machine = scope === "client" ? clientLabel : (scopeHost?.label ?? scope);
  const endpoints = scope === "client" ? state.clientEndpoints : preferencesOf(scope).hostEndpoints;

  const save = async (value: PredictionClientEndpoints) => {
    if (scope === "client") await setClientEndpoints(polaris(), value);
    else
      await setPredictionPreferences(polaris(), scope, {
        ...preferencesOf(scope),
        hostEndpoints: value,
      });

    const key =
      scope === "client" ? hosts.find((host) => hostConnected(hosts, host.key))?.key : scope;

    if (key) await inspectPredictionHost(polaris(), key, true);
  };

  const enabled = async (on: boolean) => {
    try {
      await setPredictionEnabled(polaris(), on);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  };

  return (
    <section id="tab-completion" aria-label="Tab completion" className="gap-section flex flex-col">
      <Heading>Tab completion</Heading>
      <SettingRow
        htmlFor="enable-tab-completion"
        title="Enable tab completion"
        caption={`Suggest code as you type. Tab accepts; ${commandShortcut("editor.prediction.acceptWord")} accepts a word.`}
      >
        <Switch
          id="enable-tab-completion"
          checked={state.enabled}
          disabled={
            !state.loaded ||
            (!state.enabled &&
              state.clientEndpoints.length +
                Object.values(state.preferences).reduce(
                  (count, prefs) => count + prefs.hostEndpoints.length,
                  0
                ) ===
                0)
          }
          onCheckedChange={(on) => void enabled(on)}
        />
      </SettingRow>
      <div className="gap-gap flex flex-col">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-heading-sm text-text-strong font-medium">Model server</h3>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            aria-label="Model server machine"
            className={`${CONTROL} max-w-64`}
          >
            <option value="client">This machine · {clientLabel}</option>
            {hosts
              .filter((host) => host.alias !== null)
              .map((host) => (
                <option key={host.key} value={host.key}>
                  {host.label}
                </option>
              ))}
          </select>
        </div>
        <p className="text-caption text-text-subtle">
          Run llama-server, LM Studio or Ollama on a machine you use for completion. llama-server is
          recommended.
        </p>
        <EndpointForm key={scope} endpoints={endpoints} machine={machine} save={save} />
      </div>
      <div className="gap-gap flex flex-col">
        <Heading>Completion placement</Heading>
        <p className="text-caption text-text-subtle">
          Auto uses the stronger machine, then falls back to the other side if available.
        </p>
        {hosts.map((host) => {
          const preferences = state.preferences[host.key] ?? preferencesOf(host.key);
          const inspection = state.inspections[host.key];
          const result = state.results[host.key];
          const weak = /raspberry pi/i.test(inspection?.host?.machine.chip ?? "");

          const models = [
            ...new Set(
              [
                ...(inspection?.client.endpoints ?? []),
                ...(inspection?.host?.endpoints ?? []),
              ].flatMap((endpoint) => endpoint.models)
            ),
          ];

          const caption = result
            ? `Served by ${result.machine} · ${modelName(result.model)}${weak ? " · this host is too small to serve" : ""}`
            : weak
              ? `This host is too small to serve; ${clientLabel} can serve instead`
              : "Not yet used";

          return (
            <div
              key={host.key}
              className="border-hairline gap-gap pb-row-pad flex flex-col border-b"
            >
              <SettingRow title={host.label} caption={caption}>
                <select
                  aria-label={`Completion placement for ${host.label}`}
                  className={`${CONTROL} w-40`}
                  value={preferences.placement}
                  onChange={(event) => {
                    const placement = Schema.decodeUnknownSync(Placement)(event.target.value);
                    void setPredictionPreferences(polaris(), host.key, {
                      ...preferences,
                      placement,
                    }).catch((cause) => setError(String(cause)));
                  }}
                >
                  {CHOICES.map((choice) => (
                    <option
                      key={choice.value}
                      value={choice.value}
                      disabled={choice.value === "host" && weak}
                    >
                      {choice.label}
                    </option>
                  ))}
                </select>
              </SettingRow>
              <label className="text-caption text-text-subtle flex items-center gap-4">
                Model for code on {host.label}
                <select
                  className={`${CONTROL} flex-1`}
                  aria-label={`Completion model for ${host.label}`}
                  value={preferences.model ?? ""}
                  onChange={(event) =>
                    void setPredictionPreferences(polaris(), host.key, {
                      ...preferences,
                      model: event.target.value || null,
                      format: null,
                    }).catch((cause) => setError(String(cause)))
                  }
                >
                  <option value="">
                    Automatic · Mellum2 on 16 GB+, Qwen2.5-Coder on smaller machines
                  </option>
                  {preferences.model !== null && !models.includes(preferences.model) && (
                    <option value={preferences.model}>{preferences.model} · unavailable</option>
                  )}
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                      {/qwen3.*30b/i.test(model) ? " · large, unmeasured" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          );
        })}
      </div>
      <p className="text-caption text-text-subtle">
        Tab completion works before you trust a workspace; language-server context is added after.
      </p>
      {memory !== null && (
        <p className="text-caption text-text-subtle">
          Model server · {(memory / 1024 ** 3).toFixed(1)} GB RSS · separate from Desktop App memory
        </p>
      )}
      {error && (
        <p role="status" className="text-caption text-text-subtle">
          {error}
        </p>
      )}
    </section>
  );
};
