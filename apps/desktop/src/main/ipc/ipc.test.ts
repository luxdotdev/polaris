/**
 * The IPC contract against a stand-in HostDirectory: every method and feed is
 * wired, untrusted input is decoded before anything runs, and failures cross
 * as `IpcError`s. The real path, end to end, is `scripts/smoke.ts`.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer, ManagedRuntime, SubscriptionRef } from "effect";
import type { BatchEntry, HostView } from "../../shared/api.ts";
import { RequestInputs, SubscriptionInputs } from "../../shared/contract.ts";
import { CommandId, CommandRejected } from "@polaris/protocol";
import { type ClientServices, HostDirectory, toIpcError, UnknownHost } from "../hosts.ts";
import { Ssh } from "@polaris/client/install";
import { Machines } from "../machines/service.ts";
import { type RequestContext, requestHandlers, requestRunner } from "./requests.ts";
import { windowSubscriptions } from "./subscriptions.ts";

const view: HostView = {
  key: "local",
  label: "This Mac",
  colour: null,
  alias: null,
  proofHarness: false,
  status: {
    state: "reconnecting",
    failure: null,
    attempt: 1,
    since: 0,
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 0,
  },
};

const directory = Layer.effect(
  HostDirectory,
  Effect.map(SubscriptionRef.make<ReadonlyArray<HostView>>([view]), (views) =>
    HostDirectory.of({
      views,
      entry: () => undefined,
      connection: (key) => Effect.fail(new UnknownHost(key)),
      add: () => Effect.void,
      remove: () => Effect.void,
    })
  )
);

const services = Layer.provideMerge(
  Machines.layer({
    settings: { get: () => ({ hosts: [{ alias: "studio" }] }), update: () => undefined },
    approvals: { approved: () => new Set(), approve: () => undefined, forget: () => undefined },
    builds: { source: "none", forPlatform: () => Effect.succeed([]) },
    aliases: () => [{ alias: "studio", hostName: null, user: null }],
    localDaemon: () => Promise.reject(new Error("no local daemon in tests")),
    openTerminal: () => Promise.resolve(),
    ssh: Layer.succeed(Ssh, Ssh.of({ exec: () => Effect.die("no ssh in tests") })),
  }),
  directory
);

const context: RequestContext = {
  settings: () => ({ theme: "dark", hosts: [{ alias: "studio" }] }),
  cache: { get: () => [], put: () => undefined },
  setAppearance: () => undefined,
  proofWorkspace: () => null,
  daemonDist: null,
  writeClipboard: () => Promise.resolve(),
};

const handlers = requestHandlers(context);

const run = <A, E>(effect: Effect.Effect<A, E, ClientServices>) =>
  ManagedRuntime.make(services).runPromiseExit(effect);

describe("requests", () => {
  test("every method in the contract has a handler", () => {
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(RequestInputs).sort());
  });

  test("settings come back with their defaults filled in", async () => {
    const exit = await run(requestRunner(handlers, "settings.get")({}));

    expect(exit).toEqual(
      Exit.succeed({
        theme: "dark",
        density: "calm",
        hosts: [{ alias: "studio", label: "studio", colour: null, forwardAgent: false }],
      })
    );
  });

  test("a refusal crosses with the Daemon's reason as its message", () => {
    const refused = new CommandRejected({
      commandId: CommandId.make("c1"),
      reason: "interrupt the Turn in flight before archiving",
    });

    expect(toIpcError(refused)).toEqual({
      code: "CommandRejected",
      message: "interrupt the Turn in flight before archiving",
    });
  });

  test("an input that does not decode never reaches the handler", async () => {
    const exit = await run(requestRunner(handlers, "dispatch")({ hostKey: "local", command: {} }));

    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("InvalidInput");
  });

  test("an ssh alias that reads as an option never reaches ssh", async () => {
    const exit = await run(
      requestRunner(
        handlers,
        "machines.add"
      )({
        alias: "-oProxyCommand=evil",
        label: "x",
        colour: null,
        forwardAgent: false,
      })
    );

    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("InvalidInput");
  });

  test("a Host that doesn't exist fails as an IpcError", async () => {
    const exit = await run(
      requestRunner(handlers, "files.stat")({ hostKey: "nowhere", path: "/" })
    );

    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("UnknownHost");
  });
});

describe("subscriptions", () => {
  const open = () => {
    const runtime = ManagedRuntime.make(services);
    const sent: Array<BatchEntry> = [];

    const subs = windowSubscriptions({
      runtime,
      target: { isDestroyed: () => false, send: (_channel, entries) => sent.push(...entries) },
    });

    return { sent, subs };
  };

  test("every feed kind in the contract can be opened", () => {
    expect(Object.keys(SubscriptionInputs).sort()).toEqual(
      ["files.watch", "host", "hosts", "machines", "session", "terminal"].sort()
    );
  });

  test("the Host list arrives in a batch", async () => {
    const { sent, subs } = open();

    subs.subscribe({ id: 1, kind: "hosts", input: {} });
    await Bun.sleep(20);
    subs.dispose();

    expect(sent[0]).toEqual({ id: 1, items: [[view]] });
  });

  test("the machines list arrives: this Mac, then the remote Hosts from settings", async () => {
    const { sent, subs } = open();

    subs.subscribe({ id: 1, kind: "machines", input: {} });
    await Bun.sleep(20);
    subs.dispose();

    // SAFETY: the machines feed's items are MachineView lists.
    const machines = sent[0]?.items[0] as ReadonlyArray<{ key: string; status: unknown }>;
    expect(machines.map((m) => m.key)).toEqual(["local", "studio"]);
    expect(machines[1]?.status).toBeNull();
  });

  test("an unknown kind or undecodable input ends the subscription with an error", async () => {
    const { sent, subs } = open();

    subs.subscribe({ id: 1, kind: "nope", input: {} });
    subs.subscribe({ id: 2, kind: "session", input: { hostKey: "local" } });
    await Bun.sleep(20);
    subs.dispose();

    expect(sent.find((e) => e.id === 1)?.end?.code).toBe("UnknownSubscription");
    expect(sent.find((e) => e.id === 2)?.end?.code).toBe("InvalidInput");
  });
});
