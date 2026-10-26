import { expect, test } from "bun:test";
import type { HostView, PolarisClient } from "@polaris/sdk";
import { fakeGlasses } from "../glasses/fake.testing.ts";
import { entry, host, session } from "../model/fixtures.testing.ts";
import { startApp } from "./controller.ts";

// Only the Client boundary is faked; the controller, model, renderer and microphone run normally.
const client = (views: ReadonlyArray<HostView>, close: () => Promise<void>): PolarisClient => {
  return {
    hosts: [],
    connect: async () => {
      throw new Error("unexpected connect");
    },
    subscribeHost: async function* () {
      yield* views;
    },
    sendTurn: async () => {
      throw new Error("unexpected send");
    },
    respondToApproval: async () => {
      throw new Error("unexpected approval");
    },
    interrupt: async () => {
      throw new Error("unexpected interrupt");
    },
    continue: async () => {
      throw new Error("unexpected continue");
    },
    startSession: async () => {
      throw new Error("unexpected start");
    },
    close,
    subscribeHosts: async function* () {
      yield views;
    },
    subscribeSession: async function* () {},
    transcribe: async function* (_host: string, audio: AsyncIterable<Uint8Array>) {
      for await (const _frame of audio)
        yield { finalText: "", interimText: "hello", finished: false };
    },
  };
};

const views = [host("h", [entry(session("s", "idle"))])];

const tick = () => Bun.sleep(10);

test("a reconnect waiting for close cannot install a second client after a newer reconnect", async () => {
  const closing = Promise.withResolvers<void>();
  const glasses = fakeGlasses();
  const opened: Array<ReadonlyArray<string>> = [];

  const app = startApp({
    glasses,
    renderDelayMs: 0,
    connect: async (pairings) => {
      opened.push(pairings);

      return client(views, opened.length === 1 ? () => closing.promise : async () => {});
    },
  });

  await app.pair(["first"]);
  const old = app.reconnect();
  await app.pair(["replacement"]);
  closing.resolve();
  await old;
  expect(opened).toEqual([["first"], ["replacement"]]);
  await app.close();
});

test("closing while connect is pending disposes it, and later reconnects cannot reopen", async () => {
  const pending = Promise.withResolvers<PolarisClient>();
  let opens = 0;
  let closes = 0;

  const app = startApp({
    glasses: fakeGlasses(),
    renderDelayMs: 0,
    connect: () => {
      opens++;

      return pending.promise;
    },
  });

  const pairing = app.pair(["first"]);
  await tick();
  await app.close();
  pending.resolve(
    client(views, async () => {
      closes++;
    })
  );
  await pairing;
  await app.reconnect();
  await app.pair(["second"]);
  expect(opens).toBe(1);
  expect(closes).toBe(1);
});

test.each(["double-click", "exited", "reconnect"] as const)(
  "%s stops an active microphone",
  async (action) => {
    const glasses = fakeGlasses();

    const app = startApp({
      glasses,
      renderDelayMs: 0,
      connect: async () => client(views, async () => {}),
    });

    await app.pair(["paired"]);
    await tick();
    glasses.send({ kind: "click", index: 0 });
    await app.settled();
    glasses.send({ kind: "long-press" });
    await tick();
    expect(glasses.microphoneOn()).toBe(true);

    if (action === "reconnect") await app.reconnect();
    else glasses.send({ kind: action });
    await tick();
    expect(glasses.microphoneOn()).toBe(false);

    if (action === "reconnect")
      expect(app.state().screen).toMatchObject({ kind: "voice", voice: { phase: "failed" } });
    await app.close();
  }
);

test("a tap cannot send a finished transcript until Send is actually on the glasses", async () => {
  const glasses = fakeGlasses();
  const sent: Array<string> = [];

  const app = startApp({
    glasses,
    renderDelayMs: 50,
    connect: async () => ({
      ...client(views, async () => {}),
      transcribe: async function* () {
        yield { finalText: "run the tests", interimText: "", finished: true };
      },
      sendTurn: async (_host, _session, text) => {
        sent.push(text);
      },
    }),
  });

  await app.pair(["paired"]);
  await app.settled();
  glasses.send({ kind: "click", index: 0 });
  await app.settled();
  glasses.send({ kind: "long-press" });
  await tick();
  expect(app.state().screen).toMatchObject({ kind: "voice", voice: { phase: "review" } });
  expect(glasses.rows()).toEqual([]);
  glasses.send({ kind: "click", index: 0 });
  await tick();
  expect(sent).toEqual([]);
  await app.settled();
  expect(glasses.rows()).toEqual(["Send", "Retry", "Cancel"]);
  glasses.send({ kind: "click", index: 0 });
  await tick();
  expect(sent).toEqual(["run the tests"]);
  await app.close();
});
