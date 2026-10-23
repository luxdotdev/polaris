/**
 * Settings → Voice (ENG-404, ADR 0077): per Host, its Deepgram key for the voice that
 * Extensions relay through it. The field is never filled in: the key goes to the Host and
 * is never read back, so the row only says whether one is set and where it is kept.
 */
import { Button, Input } from "@polaris/ui";
import { type FormEvent, useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { useApp } from "../../../shell/hooks.ts";
import { CLI_HINT, keyCaption, keyToSave, unavailableLine } from "../model/voice.ts";
import type { VoiceSettingsView } from "../../../../shared/voiceContract.ts";
import { sectionInfo } from "../model/sections.ts";
import { Column, FooterStrip, Group, Heading, PageHeader } from "./parts.tsx";
import { useVoiceKey } from "./useVoiceKey.ts";

const Line = ({ line }: { readonly line: string }) => (
  <Group>
    <p className="px-panel text-caption text-text-subtle py-3">{line}</p>
  </Group>
);

const KeyForm = ({
  host,
  settings,
  setKey,
}: {
  readonly host: HostView;
  readonly settings: VoiceSettingsView;
  readonly setKey: (key: string | null) => Promise<{ readonly message: string } | null>;
}) => {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `voice-key-${host.key}`;
  const errorId = `${id}-error`;
  const key = keyToSave(draft);

  const run = async (next: string | null) => {
    setBusy(true);

    const refused = await setKey(next);

    setBusy(false);
    setError(refused?.message ?? null);

    if (refused === null) setDraft("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (key !== null && !busy) void run(key);
  };

  return (
    <Group label={`Voice on ${host.label}`}>
      <form
        onSubmit={submit}
        className="px-panel flex flex-col gap-2 py-[calc(var(--spacing-gap)+4px)]"
      >
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <label htmlFor={id} className="text-label font-regular text-text-default">
              Deepgram key
            </label>
            <span className="text-caption text-text-subtle" data-testid="voice-key-state">
              {keyCaption(settings, host.label)}
            </span>
          </div>
          {settings.keySet ? (
            <Button variant="danger" disabled={busy} onClick={() => void run(null)}>
              Remove key
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder={settings.keySet ? "Paste a new key to replace it" : "Paste an API key"}
            aria-invalid={error === null ? undefined : true}
            aria-describedby={error === null ? undefined : errorId}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            className="font-mono"
          />
          <Button type="submit" disabled={key === null || busy}>
            Save
          </Button>
        </div>
        {error === null ? null : (
          <p id={errorId} role="alert" className="text-caption text-text-subtle">
            {error}
          </p>
        )}
      </form>
      <FooterStrip>
        <span className="text-caption text-text-subtle">
          Or run <span className="font-mono">{CLI_HINT}</span> on {host.label}; it reads the key
          without showing it.
        </span>
      </FooterStrip>
    </Group>
  );
};

const HostVoiceBody = ({ host }: { readonly host: HostView }) => {
  const unavailable = unavailableLine(host);
  const { state, setKey } = useVoiceKey(host.key, unavailable === null);

  if (unavailable !== null) return <Line line={unavailable} />;

  if (state.kind === "loading") return <Line line={`Asking ${host.label}…`} />;

  if (state.kind === "failed") return <Line line={state.message} />;

  return <KeyForm host={host} settings={state.settings} setKey={setKey} />;
};

/** One Host's heading and key; exported for its tests. */
export const HostVoice = ({ host }: { readonly host: HostView }) => (
  <section className="flex flex-col gap-3" data-testid="voice-host" data-host={host.key}>
    <Heading>{host.label}</Heading>
    <HostVoiceBody host={host} />
  </section>
);

export const VoicePage = () => {
  const hosts = useApp((s) => s.hosts);
  const info = sectionInfo("voice");

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      {hosts.map((host) => (
        <HostVoice key={host.key} host={host} />
      ))}
    </Column>
  );
};
