/**
 * Right after pairing (Paper X2, X2b): the token, shown this once, as a QR
 * code and a pairing string to copy, and how it reaches the Host.
 */
import { decodePairingString } from "@polaris/protocol";
import { Button, CopyButton } from "@polaris/ui";
import { Option } from "effect";
import type { Paired } from "../useExtensions.ts";
import { QrCode } from "./QrCode.tsx";

/** "mac-studio.tail4e2a.ts.net" from the Remote Access URL; null when it is off. */
export const reachOf = (pairingString: string): string | null =>
  Option.match(decodePairingString(pairingString), {
    onNone: () => null,
    onSome: ({ url }) => (url === null ? null : (URL.parse(url)?.host ?? url)),
  });

export const Reveal = ({
  paired,
  hostLabel,
  onDone,
}: {
  readonly paired: Paired;
  readonly hostLabel: string;
  readonly onDone: () => void;
}) => {
  const reach = reachOf(paired.pairingString);

  return (
    <div
      className="rounded-card border-hairline bg-surface-raised p-panel flex gap-5 border"
      data-testid="pairing-reveal"
    >
      <QrCode text={paired.pairingString} size={172} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-label text-text-strong font-medium">
            {paired.pairing.name} is paired with {hostLabel}
          </h3>
          <p className="text-body text-text-subtle">
            Scan the code with the extension, or paste the pairing string into it. This is the only
            time Polaris shows it.
          </p>
        </div>
        <div className="border-hairline bg-surface-sunken flex h-8 items-center gap-2 rounded-[6px] border pr-1 pl-2.5">
          <span
            className="text-caption text-text-default min-w-0 flex-1 truncate font-mono"
            data-testid="pairing-string"
          >
            {paired.pairingString}
          </span>
          <CopyButton text={paired.pairingString} label="Copy" variant="button" buttonSize="xs" />
        </div>
        <p className="text-caption text-text-subtle">
          {reach === null
            ? `Remote access is off, so only extensions on ${hostLabel} can connect with it`
            : `Reaches ${hostLabel} at ${reach} through remote access`}
        </p>
        <span className="flex-1" />
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};
