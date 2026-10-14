import "../../test/dom.testing.ts";
import { TerminalOutput } from "@polaris/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  IpcError,
  PolarisApi,
  SubscriptionListener,
  TerminalItem,
} from "../../../shared/api.ts";
import { setClientPlatform } from "../../../shared/platform.ts";
import { standInBridge } from "../bridge.ts";
import { loaded } from "./loaded.ts";
import { disposeTerminal, fitTerminal, mountTerminal, reattachDropped } from "./runtime.ts";
import type { TabStatus } from "./model/tabs.ts";
import { onTerminalStatus } from "./store.ts";

/** One `terminal` feed the runtime opened through the bridge. */
interface Feed {
  readonly hostKey: string;
  readonly terminalId: string;
  readonly listener: SubscriptionListener<TerminalItem>;
  closed: boolean;
}

/** The fields of the requests the runtime sends: ids, sizes, an action, input bytes. */
type Field = string | number | Uint8Array;

interface Sent {
  readonly method: string;
  readonly input: Readonly<Record<string, Field>>;
}

const feeds: Array<Feed> = [];

const sent: Array<Sent> = [];

/** While set, requests wait on it: a request still in flight. */
let inFlight: Promise<void> | null = null;

const bytes = (text: string) => new TextEncoder().encode(text);

const typed = () =>
  sent.flatMap(({ method, input }) =>
    // SAFETY: the runtime sends `terminal.input` with its bytes in `data`.
    method === "terminal.input" ? [new TextDecoder().decode(input.data as Uint8Array)] : []
  );

const sentOf = (method: string) => sent.flatMap((s) => (s.method === method ? [s.input] : []));

const feedsOf = (terminalId: string) => feeds.filter((f) => f.terminalId === terminalId);

const latestFeed = (terminalId: string) => {
  const feed = feedsOf(terminalId).at(-1);

  if (feed === undefined) throw new Error(`no feed for ${terminalId}`);

  return feed;
};

const until = async (done: () => boolean, label: string) => {
  const deadline = Date.now() + 2000;

  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const screen = (terminalId: string) => window.__polarisTerminal?.text(terminalId) ?? null;

const output = (feed: Feed, text: string) =>
  feed.listener.items([TerminalOutput.Output({ data: bytes(text) })]);

const dropped: IpcError = { code: "NotConnected", message: "The Host disconnected." };

const mounted: Array<{ hostKey: string; terminalId: string }> = [];

const mount = (hostKey: string, terminalId: string) => {
  const container = document.createElement("div");

  document.body.append(container);
  mounted.push({ hostKey, terminalId });

  return { container, unmount: mountTerminal(container, hostKey, terminalId) };
};

const press = (container: HTMLElement, init: KeyboardEventInit) => {
  const input = container.querySelector("textarea");

  if (input === null) throw new Error("the terminal has no input");
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
};

const type = (container: HTMLElement, text: string) => {
  for (const key of text) press(container, { key, keyCode: key.toUpperCase().charCodeAt(0) });
};

beforeEach(() => {
  feeds.length = 0;
  sent.length = 0;
  inFlight = null;
  standInBridge({
    // SAFETY: the fake answers every request the runtime sends with `null`, their output type.
    request: ((method: string, input: Readonly<Record<string, Field>>) => {
      sent.push({ method, input });

      return (inFlight ?? Promise.resolve()).then(() => ({ ok: true, value: null }));
    }) as PolarisApi["request"],
    // SAFETY: the runtime opens only `terminal` feeds, whose items are TerminalItems.
    subscribe: ((
      _kind: "terminal",
      input: { hostKey: string; terminalId: string },
      listener: SubscriptionListener<TerminalItem>
    ) => {
      const feed: Feed = { ...input, listener, closed: false };

      feeds.push(feed);

      return () => {
        feed.closed = true;
      };
    }) as PolarisApi["subscribe"],
    onAppEvent: () => () => undefined,
  });
});

afterEach(() => {
  for (const { hostKey, terminalId } of mounted.splice(0)) disposeTerminal(hostKey, terminalId);
  document.body.replaceChildren();
  standInBridge(null);
  setClientPlatform(null);
});

describe("attaching", () => {
  test("a mounted terminal shows its feed's output and reports the shell's exit", async () => {
    const exits: Array<TabStatus> = [];
    const off = onTerminalStatus("t-out", (status) => exits.push(status));

    mount("host", "t-out");
    const feed = latestFeed("t-out");

    expect(feed.hostKey).toBe("host");
    output(feed, "hello from the shell\r\n");
    await until(() => screen("t-out")?.includes("hello from the shell") === true, "output");

    feed.listener.items([TerminalOutput.Exit({ code: 3 })]);
    off();

    expect(exits).toEqual([{ kind: "exited", code: 3 }]);
  });

  test("unmounting keeps the terminal and its scrollback; mounting again doesn't reattach", async () => {
    const first = mount("host", "t-keep");

    output(latestFeed("t-keep"), "still here\r\n");
    await until(() => screen("t-keep")?.includes("still here") === true, "output");
    first.unmount();
    mount("host", "t-keep");

    expect(feedsOf("t-keep")).toHaveLength(1);
    expect(latestFeed("t-keep").closed).toBe(false);
    expect(screen("t-keep")).toContain("still here");
  });

  test("beyond four hidden terminals the least recently shown is dropped, closing its feed", () => {
    const ids = ["t-h1", "t-h2", "t-h3", "t-h4", "t-h5"];

    for (const id of ids) mount("host", id).unmount();

    expect(ids.map((id) => latestFeed(id).closed)).toEqual([true, false, false, false, false]);
    expect(screen("t-h1")).toBeNull();

    mount("host", "t-h1");

    expect(feedsOf("t-h1")).toHaveLength(2);
  });

  test("disposing a closed terminal closes its feed and forgets it", () => {
    mount("host", "t-gone");
    disposeTerminal("host", "t-gone");

    expect(latestFeed("t-gone").closed).toBe(true);
    expect(screen("t-gone")).toBeNull();
  });
});

describe("input", () => {
  test("keystrokes reach the PTY in order, batched behind the request in flight", async () => {
    let finish = () => {};

    inFlight = new Promise((resolve) => {
      finish = resolve;
    });
    const { container } = mount("host", "t-in");

    type(container, "l");
    type(container, "s");
    press(container, { key: "Enter", keyCode: 13 });

    expect(typed()).toEqual(["l"]);
    expect(sentOf("terminal.input")[0]).toMatchObject({ hostKey: "host", terminalId: "t-in" });

    inFlight = null;
    finish();
    await until(() => typed().length === 2, "the batched input");

    expect(typed()).toEqual(["l", "s\r"]);
  });

  test("the Windows paste key asks main to paste instead of typing into the shell", () => {
    setClientPlatform("win32");
    const { container } = mount("host", "t-paste");

    press(container, { key: "V", keyCode: 86, ctrlKey: true, shiftKey: true });

    expect(sentOf("edit.run")).toEqual([{ action: "paste" }]);
    expect(typed()).toEqual([]);
  });

  test("the Windows copy key copies the terminal's selection", async () => {
    setClientPlatform("win32");
    const { container } = mount("host", "t-copy");

    output(latestFeed("t-copy"), "copy me");
    await until(() => screen("t-copy")?.includes("copy me") === true, "output");
    loaded.runtime?.selectAll("host", "t-copy");
    press(container, { key: "C", keyCode: 67, ctrlKey: true, shiftKey: true });

    expect(sentOf("clipboard.write")).toHaveLength(1);
    expect(String(sentOf("clipboard.write")[0]?.text).trim()).toBe("copy me");
    expect(typed()).toEqual([]);
  });
});

describe("reattaching", () => {
  test("a feed dropped with the connection reattaches with its Host, onto a cleared screen", async () => {
    mount("host", "t-drop");
    const first = latestFeed("t-drop");

    output(first, "before the drop\r\n");
    await until(() => screen("t-drop")?.includes("before the drop") === true, "output");
    first.listener.end?.(dropped);

    reattachDropped("another-host");
    expect(feedsOf("t-drop")).toHaveLength(1);

    reattachDropped("host");
    expect(feedsOf("t-drop")).toHaveLength(2);
    expect(screen("t-drop")).not.toContain("before the drop");

    output(latestFeed("t-drop"), "replayed\r\n");
    await until(() => screen("t-drop")?.includes("replayed") === true, "the replay");
    reattachDropped("host");

    expect(feedsOf("t-drop")).toHaveLength(2);
  });

  test.each([
    ["ended cleanly", null],
    ["lost its terminal", { code: "NotFound", message: "No such terminal." }],
  ] as const)("a feed that %s isn't reattached", (_, error) => {
    mount("host", "t-ended");
    latestFeed("t-ended").listener.end?.(error);
    reattachDropped("host");

    expect(feedsOf("t-ended")).toHaveLength(1);
  });

  test("a feed whose terminal is gone marks it exited, without a code", () => {
    const exits: Array<TabStatus> = [];
    const off = onTerminalStatus("t-missing", (status) => exits.push(status));

    mount("host", "t-missing");
    latestFeed("t-missing").listener.end?.({ code: "NotFound", message: "No such terminal." });
    off();

    expect(exits).toEqual([{ kind: "exited", code: null }]);
  });
});

describe("resizing", () => {
  const proto = HTMLElement.prototype;

  const descriptors = ["offsetWidth", "offsetHeight"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const
  );

  const layout = document.createElement("style");

  /** happy-dom has no layout: xterm measures a 7×21 px cell, its container is `width`×`height`. */
  const size = (width: number, height: number) => {
    layout.textContent = `.w-full { width: ${width}px; } .h-full { height: ${height}px; } .xterm { padding: 0px; }`;
  };

  beforeAll(() => {
    for (const [name, cell] of [
      ["offsetWidth", 7 * 32],
      ["offsetHeight", 16],
    ] as const) {
      Object.defineProperty(proto, name, {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains("xterm-char-measure-element") ? cell : 0;
        },
      });
    }

    document.head.append(layout);
  });

  afterAll(() => {
    for (const [name, descriptor] of descriptors)
      if (descriptor !== undefined) Object.defineProperty(proto, name, descriptor);

    layout.remove();
  });

  test("the Daemon hears the size once it settles, not every step of a drag", async () => {
    size(800, 400);
    mount("host", "t-size");
    await until(() => sentOf("terminal.resize").length === 1, "the first fit");

    expect(sentOf("terminal.resize")).toEqual([
      { hostKey: "host", terminalId: "t-size", cols: 112, rows: 19 },
    ]);

    size(600, 300);
    fitTerminal("host", "t-size");
    size(500, 200);
    fitTerminal("host", "t-size");
    await until(() => sentOf("terminal.resize").length === 2, "the settled size");
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(sentOf("terminal.resize").slice(1)).toEqual([
      { hostKey: "host", terminalId: "t-size", cols: 69, rows: 9 },
    ]);
  });
});
