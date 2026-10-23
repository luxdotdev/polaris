import { describe, expect, test } from "bun:test";
import type { AppEvent } from "../shared/api.ts";
import { createDeepLinkInbox } from "./deepLinks.ts";

const harness = () => {
  const sent: Array<AppEvent> = [];
  const logged: Array<string> = [];
  let focused = 0;
  const inbox = createDeepLinkInbox((line) => logged.push(line));
  const window = { send: (event: AppEvent) => sent.push(event), focus: () => (focused += 1) };

  return { inbox, window, sent, logged, focused: () => focused };
};

describe("createDeepLinkInbox", () => {
  test("a link before the window is ready waits for it, then focuses and navigates", () => {
    const h = harness();

    h.inbox.receive("polaris://workspace/h1/w1");
    expect(h.sent).toEqual([]);
    h.inbox.attach(h.window);
    expect<ReadonlyArray<unknown>>(h.sent).toEqual([
      { kind: "deep-link", link: { target: "workspace", hostId: "h1", workspaceId: "w1" } },
    ]);
    expect(h.focused()).toBe(1);
  });

  test("only the latest link before launch navigates", () => {
    const h = harness();

    h.inbox.receive("polaris://session/h1/s1");
    h.inbox.receive("polaris://session/h1/s2");
    h.inbox.attach(h.window);
    expect<ReadonlyArray<unknown>>(h.sent).toEqual([
      { kind: "deep-link", link: { target: "session", hostId: "h1", sessionId: "s2" } },
    ]);
  });

  test("once attached, links go straight through", () => {
    const h = harness();

    h.inbox.attach(h.window);
    h.inbox.receive("polaris://session/h1/s1");
    expect<ReadonlyArray<unknown>>(h.sent).toEqual([
      { kind: "deep-link", link: { target: "session", hostId: "h1", sessionId: "s1" } },
    ]);
  });

  test("a link during renderer reload waits for its replacement listener", () => {
    const h = harness();

    h.inbox.attach(h.window);
    h.inbox.detach();
    h.inbox.receive("polaris://session/h1/s1");
    h.inbox.receive("polaris://workspace/h1/w2");
    expect(h.sent).toEqual([]);
    h.inbox.attach(h.window);
    expect<ReadonlyArray<unknown>>(h.sent).toEqual([
      { kind: "deep-link", link: { target: "workspace", hostId: "h1", workspaceId: "w2" } },
    ]);
    h.inbox.detach();
    h.inbox.attach(h.window);
    expect(h.sent).toHaveLength(1);
  });

  test("a malformed link is logged, never sent, and doesn't replace a held one", () => {
    const h = harness();

    h.inbox.receive("polaris://session/h1/s1");
    h.inbox.receive("polaris://approve/h1/r1");
    h.inbox.attach(h.window);
    expect<ReadonlyArray<unknown>>(h.sent).toEqual([
      { kind: "deep-link", link: { target: "session", hostId: "h1", sessionId: "s1" } },
    ]);
    expect(h.logged).toEqual([
      'polaris: ignored a deep link (not a session or workspace link): "polaris://approve/h1/r1"',
    ]);
  });

  test("rejected links cannot inject control characters into the log", () => {
    const h = harness();

    h.inbox.attach(h.window);
    h.inbox.receive("polaris://session/h1/a\n\u001b[31mb");
    expect(h.sent).toEqual([]);
    expect(h.focused()).toBe(0);
    expect(h.logged).toEqual([
      'polaris: ignored a deep link (control character): "polaris://session/h1/a\\n\\u001b[31mb"',
    ]);
  });
});
