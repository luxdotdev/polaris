/**
 * xterm.js instances, one per Daemon terminal, kept alive while unmounted so
 * switching Workspaces back is instant; beyond `KEPT` hidden ones the oldest
 * is dropped (reattaching replays the Daemon's scrollback). WebGL renders.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalId } from "@polaris/protocol";
import { Predicate } from "effect";
import { polaris } from "../session/bridge.ts";
import { loaded } from "./loaded.ts";
import { applyStatus } from "./store.ts";
import { terminalTheme } from "./theme.ts";

declare global {
  interface Window {
    /** The smoke test reads what a terminal shows (WebGL leaves no text in the DOM). */
    __polarisTerminal?: { readonly text: (terminalId: string) => string | null };
  }
}

/** Hidden instances kept alive; each holds a WebGL context and its scrollback. */
const KEPT = 4;

const SCROLLBACK_LINES = 3000;

const RESIZE_DEBOUNCE_MS = 60;

interface Instance {
  readonly hostKey: string;
  readonly terminalId: string;
  readonly term: Terminal;
  readonly fit: FitAddon;
  readonly element: HTMLDivElement;
  webgl: WebglAddon | null;
  opened: boolean;
  mounted: boolean;
  lastUsed: number;
  /** Closes the feed; null when it isn't open. */
  unsubscribe: (() => void) | null;
  /** The feed ended with the connection; reattach once the Host is back. */
  dropped: boolean;
  /** Input waiting for the request in flight, so keystrokes reach the PTY in order. */
  pending: Array<Uint8Array>;
  sending: boolean;
  resizeTimer: ReturnType<typeof setTimeout> | null;
}

const instances = new Map<string, Instance>();

const keyOf = (hostKey: string, terminalId: string) => `${hostKey}\u0000${terminalId}`;

const encoder = new TextEncoder();

const concat = (chunks: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
};

const flushInput = (inst: Instance) => {
  if (inst.sending || inst.pending.length === 0) return;
  const data = concat(inst.pending);

  inst.pending = [];
  inst.sending = true;
  void polaris()
    .request("terminal.input", {
      hostKey: inst.hostKey,
      // SAFETY: terminal ids come from `terminal.open` answers, persisted as strings.
      terminalId: inst.terminalId as TerminalId,
      data,
    })
    .finally(() => {
      inst.sending = false;
      flushInput(inst);
    });
};

const send = (inst: Instance, data: Uint8Array) => {
  inst.pending.push(data);
  flushInput(inst);
};

const attach = (inst: Instance) => {
  inst.dropped = false;
  inst.term.reset();
  inst.unsubscribe = polaris().subscribe(
    "terminal",
    // SAFETY: as in flushInput.
    { hostKey: inst.hostKey, terminalId: inst.terminalId as TerminalId },
    {
      items: (items) => {
        for (const item of items) {
          if (Predicate.isTagged(item, "Output")) inst.term.write(item.data);
          else applyStatus(inst.terminalId, { kind: "exited", code: item.code });
        }
      },
      end: (error) => {
        inst.unsubscribe = null;

        if (error === null) return;

        if (error.code === "NotFound") applyStatus(inst.terminalId, { kind: "exited", code: null });
        else inst.dropped = true;
      },
    }
  );
};

const resize = (inst: Instance, cols: number, rows: number) => {
  if (inst.resizeTimer !== null) clearTimeout(inst.resizeTimer);
  inst.resizeTimer = setTimeout(() => {
    inst.resizeTimer = null;
    void polaris().request("terminal.resize", {
      hostKey: inst.hostKey,
      // SAFETY: as in flushInput.
      terminalId: inst.terminalId as TerminalId,
      cols,
      rows,
    });
  }, RESIZE_DEBOUNCE_MS);
};

const monoFamily = () =>
  `"SF Mono", SFMono-Regular, ${getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "ui-monospace, Menlo, monospace"}`;

const create = (hostKey: string, terminalId: string): Instance => {
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: monoFamily(),
    fontSize: 12,
    lineHeight: 16 / 12,
    letterSpacing: 0,
    cursorBlink: false,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    scrollback: SCROLLBACK_LINES,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    drawBoldTextInBrightColors: false,
    fontWeight: 400,
    fontWeightBold: 500,
    theme: terminalTheme(),
  });

  const fit = new FitAddon();
  const element = document.createElement("div");

  element.className = "h-full w-full";
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";

  const inst: Instance = {
    hostKey,
    terminalId,
    term,
    fit,
    element,
    webgl: null,
    opened: false,
    mounted: false,
    lastUsed: performance.now(),
    unsubscribe: null,
    dropped: false,
    pending: [],
    sending: false,
    resizeTimer: null,
  };

  term.onData((data) => send(inst, encoder.encode(data)));
  term.onBinary((data) =>
    send(
      inst,
      Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff)
    )
  );
  term.onResize(({ cols, rows }) => resize(inst, cols, rows));
  attach(inst);

  return inst;
};

const loadWebgl = (inst: Instance) => {
  if (inst.webgl !== null) return;

  try {
    const webgl = new WebglAddon();

    webgl.onContextLoss(() => {
      webgl.dispose();
      inst.webgl = null;
    });
    inst.term.loadAddon(webgl);
    inst.webgl = webgl;
  } catch {
    // No WebGL (a GPU blocklist, a lost context): xterm's DOM renderer takes over.
    inst.webgl = null;
  }
};

const dispose = (inst: Instance) => {
  inst.unsubscribe?.();

  if (inst.resizeTimer !== null) clearTimeout(inst.resizeTimer);
  inst.term.dispose();
  instances.delete(keyOf(inst.hostKey, inst.terminalId));
};

const evict = () => {
  const hidden = [...instances.values()]
    .filter((i) => !i.mounted)
    .sort((a, b) => b.lastUsed - a.lastUsed);

  for (const inst of hidden.slice(KEPT)) dispose(inst);
};

/** Fits the terminal to its container; call when the container's size changes. */
export const fitTerminal = (hostKey: string, terminalId: string) => {
  const inst = instances.get(keyOf(hostKey, terminalId));

  if (inst?.mounted === true) inst.fit.fit();
};

/** Puts the terminal into `container` (creating and attaching it once); returns the unmount. */
export const mountTerminal = (container: HTMLElement, hostKey: string, terminalId: string) => {
  const key = keyOf(hostKey, terminalId);
  const inst = instances.get(key) ?? create(hostKey, terminalId);

  instances.set(key, inst);
  container.append(inst.element);
  inst.mounted = true;

  if (!inst.opened) {
    inst.term.open(inst.element);
    inst.opened = true;
    loadWebgl(inst);
  }

  inst.fit.fit();

  return () => {
    inst.element.remove();
    inst.mounted = false;
    inst.lastUsed = performance.now();
    evict();
  };
};

export const focusTerminal = (hostKey: string, terminalId: string) =>
  instances.get(keyOf(hostKey, terminalId))?.term.focus();

/** Forgets a terminal the user closed (or that was replaced by a reopen). */
export const disposeTerminal = (hostKey: string, terminalId: string) => {
  const inst = instances.get(keyOf(hostKey, terminalId));

  if (inst !== undefined) dispose(inst);
};

/** Reattaches the feeds that ended when the Host's connection dropped. */
export const reattachDropped = (hostKey: string) => {
  for (const inst of instances.values())
    if (inst.hostKey === hostKey && inst.dropped && inst.unsubscribe === null) attach(inst);
};

/** The theme follows the appearance: `data-theme` on the root, or the system's. */
const retheme = () => {
  if (instances.size === 0) return;
  const theme = terminalTheme();

  for (const inst of instances.values()) inst.term.options.theme = theme;
};

loaded.runtime = { disposeTerminal, reattachDropped };

if ("document" in globalThis) {
  new MutationObserver(retheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme);

  window.__polarisTerminal = {
    text: (terminalId) => {
      const inst = [...instances.values()].find((i) => i.terminalId === terminalId);

      if (inst === undefined) return null;
      const buffer = inst.term.buffer.active;
      const lines: Array<string> = [];

      for (let y = 0; y < buffer.length; y++)
        lines.push(buffer.getLine(y)?.translateToString(true) ?? "");

      return lines.join("\n");
    },
  };
}
