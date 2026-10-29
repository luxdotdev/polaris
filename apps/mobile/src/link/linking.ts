/**
 * Linking as the scan sheet steps through it: scan or paste, then one link through the Polaris
 * Relay. The link holds a one-time secret: it goes only to `onLink`, never to a log or the screen.
 */
import type { LinkedHost } from "@polaris/client/relay";
import { decodeLinkString } from "@polaris/protocol";
import { Option } from "effect";
import type { LinkOutcome } from "../relay/RelayProvider.tsx";

export type { LinkOutcome };

export type LinkStep =
  | { readonly kind: "scan" }
  | { readonly kind: "paste" }
  | { readonly kind: "linking"; readonly hostName: string; readonly count: number }
  | { readonly kind: "linked"; readonly hostName: string; readonly count: number }
  | { readonly kind: "failed"; readonly message: string };

export const hostsLine = (count: number, hostName: string): string =>
  `Found ${count} ${count === 1 ? "host" : "hosts"} on ${hostName}`;

export const NOT_A_LINK = "That isn't a Polaris link.";

/** The Keychain refused the keys; the link itself was used. */
export const NOT_SAVED = "Couldn't save the link on this iPhone. Make a new one and try again.";

export interface LinkingOptions {
  readonly onLink: (link: string) => Promise<LinkOutcome>;
  readonly onStep: (step: LinkStep) => void;
  readonly onLinked?: ((hosts: ReadonlyArray<LinkedHost>) => void) | undefined;
}

export interface Linking {
  /** A scanned code or the pasted text; ignored while a link is under way. */
  readonly submit: (text: string) => void;
  /** Back to the scanner or the paste field. */
  readonly show: (kind: "scan" | "paste") => void;
}

export const linking = ({ onLink, onStep, onLinked }: LinkingOptions): Linking => {
  let step: LinkStep = { kind: "scan" };
  let busy = false;

  const go = (next: LinkStep) => {
    step = next;
    onStep(next);
  };

  return {
    show: (kind) => {
      if (!busy) go({ kind });
    },
    submit: (text) => {
      if (busy) return;
      const envelope = Option.getOrNull(decodeLinkString(text));

      // A QR code that isn't a Polaris link is ignored while scanning.
      if (envelope === null) {
        if (step.kind === "paste") go({ kind: "failed", message: NOT_A_LINK });

        return;
      }

      busy = true;
      const hostName = envelope.link.hostName;
      const count = 1 + envelope.hosts.length;
      go({ kind: "linking", hostName, count });

      const failed = (message: string) => {
        busy = false;
        go({ kind: "failed", message });
      };

      onLink(text).then(
        (outcome) => {
          if (!outcome.linked) return failed(outcome.message);
          go({ kind: "linked", hostName, count });
          onLinked?.(outcome.hosts);
        },
        () => failed(NOT_SAVED)
      );
    },
  };
};
