/**
 * The phone's side of the app, in the Even app's WebView: the paired Hosts and
 * how they stand, and pairing by pasting or scanning a pairing string.
 */
import type { HostView } from "@polaris/sdk";
import { addPairing, removeHost, type Stored } from "./pairings.ts";

export interface PhonePageOptions {
  readonly stored: ReadonlyArray<Stored>;
  /** The pairings changed: keep them and connect again. */
  readonly onChange: (stored: ReadonlyArray<Stored>) => void;
  /** Null when there is no camera to scan with. */
  readonly scan: (() => Promise<string | null>) | null;
}

export interface PhonePage {
  readonly showHosts: (hosts: ReadonlyArray<HostView>) => void;
}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = ""
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  node.textContent = text;

  if (className !== "") node.className = className;

  return node;
};

const UNREACHABLE_HINT =
  "Check that Tailscale is connected on this phone and that your tailnet lets it reach the host.";

const statusOf = (view: HostView | undefined) => {
  if (view === undefined) return "Connecting…";

  if (view.error !== null) return `Can't reach it. ${UNREACHABLE_HINT}`;

  if (!view.connected) return "Reconnecting…";
  const count = view.sessions.length;

  return `Connected · ${count} agent session${count === 1 ? "" : "s"}`;
};

export const mountPhonePage = (root: HTMLElement, options: PhonePageOptions): PhonePage => {
  let stored = options.stored;
  let views: ReadonlyArray<HostView> = [];
  const hostList = element("ul", "", "hosts");
  const message = element("p", "", "message");
  const input = element("textarea");
  const pair = element("button", "Pair");
  const scan = element("button", "Scan QR code", "secondary");

  input.placeholder = "polaris-pair:v1:…";
  input.rows = 3;
  input.autocapitalize = "off";
  input.spellcheck = false;

  const say = (text: string, error = false) => {
    message.textContent = text;
    message.classList.toggle("error", error);
  };

  const renderHosts = () => {
    const hosts = [
      ...new Map(stored.map((entry) => [entry.pairing.hostId, entry.pairing])).values(),
    ];

    hostList.replaceChildren(
      ...(hosts.length === 0
        ? [element("li", "No hosts yet.", "empty")]
        : hosts.map((host) => {
            const row = element("li");
            const remove = element("button", "Unpair", "secondary");

            remove.addEventListener("click", () => {
              stored = removeHost(stored, host.hostId);
              options.onChange(stored);
              renderHosts();
            });
            row.append(
              element("strong", host.hostName),
              element("span", statusOf(views.find((view) => view.hostId === host.hostId))),
              remove
            );

            return row;
          }))
    );
  };

  const add = (text: string) => {
    const result = addPairing(stored, text);

    if (!result.ok) return say(result.error, true);
    stored = result.stored;
    input.value = "";
    say(`Paired with ${result.added.hostName}. The glasses show its agent sessions.`);
    options.onChange(stored);
    renderHosts();
  };

  pair.addEventListener("click", () => add(input.value));
  const scanner = options.scan;

  if (scanner === null) scan.hidden = true;
  else
    scan.addEventListener("click", () => {
      say("");
      scanner().then(
        (text) => (text === null ? undefined : add(text)),
        (cause: unknown) => say(cause instanceof Error ? cause.message : String(cause), true)
      );
    });

  const actions = element("div", "", "actions");

  actions.append(pair, scan);
  root.replaceChildren(
    element("h1", "Polaris"),
    element("p", "Your agent sessions and approvals on your glasses.", "lede"),
    element("h2", "Hosts"),
    hostList,
    element("h2", "Pair with a host"),
    element(
      "p",
      "In Polaris on your Mac, open Settings → Extensions and add a pairing. Scan its QR code, or paste its pairing string here.",
      "help"
    ),
    input,
    actions,
    message
  );
  renderHosts();

  return {
    showHosts: (hosts) => {
      views = hosts;
      renderHosts();
    },
  };
};
