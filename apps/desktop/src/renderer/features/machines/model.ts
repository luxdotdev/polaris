/**
 * What each machine row says and offers, from its `MachineView`: the
 * Connection State line and the one inline card (Needs Attention reason,
 * install approval, progress, problem). Pure, so every reason is tested.
 * Copy follows DESIGN.md (Onboarding, Settings · Hosts; rule/glossary-lowercase).
 */
import type { MachineView } from "../../../shared/api.ts";

/** What a card's buttons do; the view binds each to a request. */
export type CardAction =
  | "open-ssh"
  | "retry"
  | "check"
  | "start-daemon"
  | "copy-detail"
  | "approve"
  | "dismiss";

export interface CardButton {
  readonly label: string;
  readonly action: CardAction;
}

export interface CardModel {
  /** The kicker: the reason code as the client reports it. */
  readonly reason: string;
  readonly title: string;
  readonly body: string;
  /** The command or stderr line, in a well. */
  readonly detail: string | null;
  /** At most one fix. A changed host key never gets one. */
  readonly fix: CardButton | null;
  readonly secondary: CardButton | null;
}

const card = (
  reason: string,
  title: string,
  body: string,
  detail: string | null,
  fix: CardButton | null = null,
  secondary: CardButton | null = null
): CardModel => ({ reason, title, body, detail, fix, secondary });

const RETRY: CardButton = { label: "Retry", action: "retry" };

const COPY: CardButton = { label: "Copy command", action: "copy-detail" };

const orNull = (text: string | undefined) => (text === undefined || text === "" ? null : text);

/** The card for a Connection State failure the user must see; null for none. */
const connectionCard = (machine: MachineView): CardModel | null => {
  const failure = machine.status?.failure;

  if (machine.status?.state !== "needs-attention" || failure === undefined || failure === null)
    return null;
  const { label } = machine;
  const alias = machine.alias ?? "localhost";
  const detail = orNull(failure.detail);

  switch (failure.reason) {
    case "host-key-unknown":
      return card(
        failure.reason,
        `${label}'s host key isn't trusted yet`,
        "Connect once in a terminal and accept the key. Polaris retries when you're back.",
        `ssh ${alias}`,
        { label: "Open in terminal", action: "open-ssh" },
        RETRY
      );
    case "host-key-changed":
      return card(
        failure.reason,
        `${label}'s host key changed`,
        "It no longer matches known_hosts. If you rebuilt the machine, remove the old key and retry. If you didn't, don't connect.",
        `ssh-keygen -R ${alias}`,
        null,
        { label: `Copy ssh-keygen -R ${alias}`, action: "copy-detail" }
      );
    case "auth-failed":
      return card(
        failure.reason,
        `${label} refused the key`,
        "Polaris never answers password or 2FA prompts. Load a key into ssh-agent, then retry.",
        detail,
        RETRY,
        { label: "Open in terminal", action: "open-ssh" }
      );
    case "daemon-not-running":
      return card(
        failure.reason,
        `The daemon on ${label} isn't running`,
        "Its agent sessions are kept and resume once it starts.",
        detail,
        { label: "Start daemon", action: "start-daemon" },
        RETRY
      );
    case "protocol-mismatch":
      return card(
        failure.reason,
        `${label} runs an older daemon`,
        "The upgrade hands off in place; working agent sessions keep going.",
        detail,
        { label: "Upgrade", action: "check" }
      );
    case "polaris-not-installed":
      return card(
        failure.reason,
        `Polaris isn't installed on ${label}`,
        "The daemon runs there once you approve the install.",
        detail,
        { label: "Install", action: "check" }
      );
    case "ssh-config-error":
      return card(
        failure.reason,
        `ssh refused its config for ${alias}`,
        "Fix what ssh names below, in ~/.ssh, then retry.",
        detail,
        RETRY
      );
    default:
      return card(
        failure.reason,
        `Polaris can't reach ${label}`,
        "Retry once it's fixed.",
        detail,
        RETRY
      );
  }
};

const sizeLabel = (bytes: number | null) => {
  if (bytes === null) return "";

  return bytes < 100_000
    ? ` · ${Math.ceil(bytes / 1000)} KB`
    : ` · ${(bytes / 1_000_000).toFixed(1)} MB`;
};

type Problem = NonNullable<NonNullable<MachineView["install"]>["problem"]>;

const problemCard = (label: string, problem: Problem): CardModel => {
  if (problem.kind === "host-setup") {
    return card(
      "host-setup",
      `${label} needs a little setup first`,
      `${problem.message} An administrator can install them; then retry.`,
      problem.command,
      { label: "Retry", action: "check" },
      COPY
    );
  }

  if (problem.kind === "ssh") {
    return card(
      "ssh",
      `Polaris couldn't reach ${label} over SSH`,
      "Check that ssh reaches it from a terminal, then retry.",
      problem.message,
      { label: "Retry", action: "check" }
    );
  }

  if (problem.kind === "failed") {
    return card(
      "install-failed",
      `Installing on ${label} didn't finish`,
      "Nothing half-installed is left running. Try again, or check the host.",
      problem.message,
      { label: "Try again", action: "check" }
    );
  }

  return card(problem.kind, `Polaris can't run on ${label}`, problem.message, null);
};

/** The install flow's card: approval, progress, a problem, or a note an admin must act on. */
export const installCard = (machine: MachineView): CardModel | null => {
  const install = machine.install;

  if (install === null) return null;
  const { label } = machine;

  switch (install.step) {
    case "checking":
    case "installing":
      return card(
        install.step === "checking" ? "checking" : "installing",
        install.step === "checking" ? `Checking ${label}` : `Installing on ${label}`,
        install.activity ?? "Working over SSH.",
        null
      );
    case "dismissed":
      return card(
        "not-installed",
        `Polaris isn't installed on ${label}`,
        "Nothing was copied. Install whenever you're ready.",
        null,
        { label: "Install", action: "check" }
      );
    case "blocked":
      return install.problem === null ? null : problemCard(label, install.problem);
    case "ready": {
      const admin = install.outcome?.adminCommand ?? null;

      return admin === null
        ? null
        : card(
            "linger",
            `The daemon on ${label} stops when you log out`,
            "Keeping it running needs an administrator. Ask one to run this once.",
            admin,
            null,
            COPY
          );
    }

    default:
      return null;
  }
};

/** The one card a row shows expanded: the install flow first, then the connection. */
export const attentionCard = (machine: MachineView): CardModel | null => {
  const step = machine.install?.step;

  if (step === "approval") return null;
  const install = installCard(machine);

  // ssh's own failure is better told by the Connection State's reason, when there is one.
  const sshFailed = machine.install?.problem?.kind === "ssh";

  if (install !== null && step !== "ready" && !sshFailed) return install;

  return connectionCard(machine) ?? install;
};

/** Whether the row starts expanded: something needs the user. */
export const needsUser = (machine: MachineView): boolean =>
  machine.install?.step === "approval" || attentionCard(machine) !== null;

/** "12s", "4m 05s", "1h 02m": tabular, for Reconnecting's elapsed time. */
export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};

export interface ConnectionLine {
  readonly state: "connected" | "reconnecting" | "needs-attention" | "offline" | "off";
  readonly label: string;
  /** Trailing caption: "local", "4 ms", "for 40s", "last seen 3d ago". */
  readonly caption: string | null;
  /** Offline offers "Retry" after its caption (Paper S4). */
  readonly retry: boolean;
}

/** "just now", "12m ago", "3h ago", "3d ago". */
export const ago = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);

  if (minutes < 1) return "just now";

  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);

  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

/** "local", or the latency measured when the connection opened (DESIGN.md, Settings · Hosts). */
const connectedCaption = (alias: string | null, latencyMs: number | null) => {
  if (alias === null) return "local";

  if (latencyMs === null) return null;

  return latencyMs < 1 ? "<1 ms" : `${latencyMs} ms`;
};

/** The Connection column: state word and its caption at `now`. */
export const connectionLine = (machine: MachineView, now: number): ConnectionLine => {
  const status = machine.status;

  if (status === null) return { state: "off", label: "Off", caption: "on this Mac", retry: false };

  switch (status.state) {
    case "connected":
      return {
        state: "connected",
        label: "Connected",
        caption: connectedCaption(machine.alias, status.latencyMs),
        retry: false,
      };
    case "reconnecting":
      return {
        state: "reconnecting",
        label: "Reconnecting",
        caption: `for ${elapsed(now - status.since)}`,
        retry: false,
      };
    case "offline":
      return {
        state: "offline",
        label: "Offline",
        caption:
          status.lastSeenAt === null
            ? "not reached yet"
            : `last seen ${ago(now - status.lastSeenAt)}`,
        retry: true,
      };
    default:
      return { state: "needs-attention", label: "Needs attention", caption: null, retry: false };
  }
};

/** "ssh studio · 3 workspaces", or "This Mac · 2 workspaces". */
export const hostCaption = (machine: MachineView, workspaces: number | null): string => {
  const where = machine.alias === null ? "This Mac" : `ssh ${machine.alias}`;

  return workspaces === null ? where : `${where} · ${workspacesText(workspaces)}`;
};

export const workspacesText = (n: number): string => `${n} ${n === 1 ? "workspace" : "workspaces"}`;

/** A just-finished upgrade or install, for the row's note. */
export const outcomeNote = (machine: MachineView): string | null => {
  const outcome = machine.install?.outcome;

  if (outcome === null || outcome === undefined) return null;

  if (outcome.kind === "upgraded")
    return `Daemon upgraded ${outcome.from ?? "?"} → ${outcome.version}`;

  if (outcome.kind === "installed") return `Daemon ${outcome.version} installed`;

  return null;
};

export const offerFacts = (machine: MachineView) => {
  const offer = machine.install?.offer;

  if (offer === null || offer === undefined) return null;
  const sha = offer.sha256.match(/.{1,8}/g) ?? [offer.sha256];

  return [
    { label: "Platform", value: offer.platform },
    { label: "Version", value: `polaris ${offer.version}${sizeLabel(offer.sizeBytes)}` },
    {
      label: "SHA-256",
      value: [sha.slice(0, 4).join(" "), sha.slice(4).join(" ")].filter((l) => l !== "").join("\n"),
    },
    { label: "Installs to", value: `~/.polaris on ${machine.alias ?? machine.label}` },
  ];
};
