// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Fake Electron passes raw envelopes to the production IPC decoder.
import { expect, test } from "bun:test";
import { registerLanguageIpc, LANGUAGE_CHANNELS, type LanguageIpcRegistrar } from "./languages.ts";
import type { LanguageApi } from "../../shared/api.ts";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Fake Electron sends raw envelopes through the production decoders.
type Handler = (
  event: Parameters<Parameters<LanguageIpcRegistrar["handle"]>[1]>[0],
  value: unknown
) => void | Promise<unknown>;

test("optional Electron routes reject foreign frames and dispose per-window subscriptions", async () => {
  const handlers = new Map<string, Handler>();

  const ipc: LanguageIpcRegistrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => {
      handlers.delete(channel);
    },
    removeAllListeners: (channel) => {
      handlers.delete(channel);
    },
  };

  let requests = 0;
  let stops = 0;

  const api: LanguageApi = {
    request: async () => {
      requests++;

      return { ok: false, error: { code: "Unsupported", message: "unavailable" } };
    },
    subscribe: () => () => {
      stops++;
    },
  };

  let destroyed: (() => void) | undefined;
  let navigated: ((details: { isMainFrame: boolean; isSameDocument: boolean }) => void) | undefined;

  const sender = {
    id: 1,
    send: () => {},
    once: (_event: "destroyed", callback: () => void) => {
      destroyed = callback;
    },
    on: (_event: "did-start-navigation", callback: NonNullable<typeof navigated>) => {
      navigated = callback;
    },
  };

  const origin = { sender, senderFrame: { url: "app://polaris" } };
  const registered = registerLanguageIpc(ipc, api, (url) => url === "app://polaris");
  expect(
    await handlers.get(LANGUAGE_CHANNELS.request)?.(
      { ...origin, senderFrame: { url: "https://foreign.example" } },
      { method: "languages.catalog", input: { hostKey: "host" } }
    )
  ).toMatchObject({ ok: false, error: { code: "Forbidden" } });
  expect(requests).toBe(0);
  await handlers.get(LANGUAGE_CHANNELS.request)?.(origin, { method: "arbitrary", input: {} });
  expect(requests).toBe(0);
  await handlers.get(LANGUAGE_CHANNELS.request)?.(origin, {
    method: "languages.catalog",
    input: { hostKey: "host" },
  });
  expect(requests).toBe(1);
  await handlers.get(LANGUAGE_CHANNELS.subscribe)?.(origin, {
    id: 1,
    kind: "languages.install.watch",
    input: { hostKey: "host", jobId: "job" },
  });
  navigated?.({ isMainFrame: true, isSameDocument: false });
  expect(stops).toBe(1);
  await handlers.get(LANGUAGE_CHANNELS.subscribe)?.(origin, {
    id: 2,
    kind: "languages.install.watch",
    input: { hostKey: "host", jobId: "job" },
  });
  destroyed?.();
  expect(stops).toBe(2);
  registered.dispose();
  expect(handlers.size).toBe(0);
});
