/**
 * Settings → Extensions (Paper X1, X2, X2b; ENG-401): per Host, its Pairings
 * with Grant and last use, Revoke, and pairing a new Extension, whose token
 * shows once as a QR code and a pairing string.
 */
import type { Grant, PairingId } from "@polaris/protocol";
import { Button, PlusIcon } from "@polaris/ui";
import { Match } from "effect";
import { useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { useApp } from "../../../shell/hooks.ts";
import { useNow } from "../../../shell/useNow.ts";
import { sectionInfo } from "../../settings/model/sections.ts";
import { Column, Group, Heading, PageHeader } from "../../settings/ui/parts.tsx";
import { livePairings } from "../model.ts";
import { type Paired, type PairingsState, useExtensions } from "../useExtensions.ts";
import { PairForm } from "./PairForm.tsx";
import { PairingRow } from "./PairingRow.tsx";
import { Reveal } from "./Reveal.tsx";

const CAPABILITY = "extensions";

type Panel =
  | { readonly kind: "closed" }
  | { readonly kind: "form" }
  | { readonly kind: "paired"; readonly paired: Paired };

const Note = ({ line }: { readonly line: string }) => (
  <p className="bg-surface-sunken rounded-card px-panel text-body text-text-subtle py-3">{line}</p>
);

const PairButton = ({ onClick }: { readonly onClick: () => void }) => (
  <Button onClick={onClick} data-testid="pair-extension">
    <PlusIcon size={12} />
    Pair an extension
  </Button>
);

const Empty = ({ label, onPair }: { readonly label: string; readonly onPair: () => void }) => (
  <div className="bg-surface-sunken rounded-card px-panel flex items-center gap-3 py-3">
    <span className="text-body text-text-subtle flex-1">No extensions paired with {label}</span>
    <PairButton onClick={onPair} />
  </div>
);

/** One connected Host's Pairings, the pair form and the one-time reveal. */
export const HostPairings = ({
  hostKey,
  label,
}: {
  readonly hostKey: string;
  readonly label: string;
}) => {
  const { state, pair, revoke } = useExtensions(hostKey, true);
  const [panel, setPanel] = useState<Panel>({ kind: "closed" });
  const now = useNow();

  if (state.kind !== "ready") return <Note line={loadingLine(state, label)} />;

  const pairings = livePairings(state.pairings);
  const open = () => setPanel({ kind: "form" });
  const close = () => setPanel({ kind: "closed" });

  const onPair = async (name: string, grant: Grant) => {
    const paired = await pair(name, grant);

    if (paired !== null) setPanel({ kind: "paired", paired });
  };

  const onRevoke = async (id: PairingId) => {
    if (await revoke(id)) {
      setPanel((current) =>
        current.kind === "paired" && current.paired.pairing.id === id ? { kind: "closed" } : current
      );
    }
  };

  if (pairings.length === 0 && panel.kind === "closed") {
    return <Empty label={label} onPair={open} />;
  }

  return (
    <>
      {pairings.length === 0 ? null : (
        <Group label={`Extensions paired with ${label}`}>
          {pairings.map((p) => (
            <PairingRow key={p.id} pairing={p} now={now} onRevoke={() => onRevoke(p.id)} />
          ))}
        </Group>
      )}
      {Match.value(panel).pipe(
        Match.discriminatorsExhaustive("kind")({
          closed: () => (
            <div>
              <PairButton onClick={open} />
            </div>
          ),
          form: () => (
            <PairForm hostKey={hostKey} hostLabel={label} onCancel={close} onPair={onPair} />
          ),
          paired: ({ paired }) => <Reveal paired={paired} hostLabel={label} onDone={close} />,
        })
      )}
    </>
  );
};

const loadingLine = (state: Exclude<PairingsState, { kind: "ready" }>, label: string) =>
  state.kind === "loading" ? `Asking ${label}…` : state.message;

const HostSection = ({ host }: { readonly host: HostView }) => {
  const connected = host.status.state === "connected";
  const supported = host.status.capabilities.includes(CAPABILITY);

  return (
    <section className="flex flex-col gap-3" data-testid="extensions-host" data-host={host.key}>
      <Heading>{host.label}</Heading>
      {!connected ? (
        <Note
          line={`${host.label} is ${host.status.state.replace("-", " ")}; its extensions show once it's connected`}
        />
      ) : !supported ? (
        <Note
          line={`The daemon on ${host.label} is too old to pair extensions; upgrade it from Hosts`}
        />
      ) : (
        <HostPairings hostKey={host.key} label={host.label} />
      )}
    </section>
  );
};

export const ExtensionsPage = () => {
  const hosts = useApp((s) => s.hosts);
  const info = sectionInfo("extensions");

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      {hosts.map((host) => (
        <HostSection key={host.key} host={host} />
      ))}
    </Column>
  );
};
