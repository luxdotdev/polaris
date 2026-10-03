import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { RendererLanguageConnections, type LanguageHostView } from "./connections.ts";

const host = (epoch = 7, hostId = P.HostId.make("fake")): LanguageHostView => ({
  key: "fake",
  status: {
    state: "connected",
    capabilities: ["languages"],
    languageConnectionEpoch: epoch,
    host: new P.HostInfo({
      hostId,
      hostname: "fixture",
      platform: "linux-x64",
      daemonVersion: "fixture",
      homeDir: "/fake",
      startedAt: "2026-10-02T00:00:00Z",
    }),
  },
});

const withoutEpoch = (value: LanguageHostView): LanguageHostView => {
  const { languageConnectionEpoch: _epoch, ...status } = value.status;

  return { ...value, status };
};

test("Main epoch token survives unrelated App objects and changes exactly on Host/epoch replacement", () => {
  let hosts = [host()];
  const connections = new RendererLanguageConnections(() => hosts);
  const first = connections.connection("fake");
  expect(first?.epoch).toBe(7);
  const unrelated = { ...host(), status: { ...host().status, latencyMs: 42 } };
  hosts = [unrelated];
  expect(connections.connection("fake")).toBe(first);
  hosts = [host(8)];
  const second = connections.connection("fake");
  expect(first?.signal.aborted).toBe(true);
  expect(second?.token).not.toBe(first?.token);
  hosts = [host(8, P.HostId.make("replacement"))];
  expect(connections.connection("fake")?.hostId).toBe(P.HostId.make("replacement"));
  expect(second?.signal.aborted).toBe(true);
  connections.dispose();
});

test("disconnect, removal, absent capability/epoch and ambiguous Host keys abort rather than mint identity", () => {
  for (const change of [
    (value: LanguageHostView): LanguageHostView[] => [
      { ...value, status: { ...value.status, state: "offline" } },
    ],
    (): LanguageHostView[] => [],
    (value: LanguageHostView): LanguageHostView[] => [
      { ...value, status: { ...value.status, capabilities: [] } },
    ],
    (value: LanguageHostView): LanguageHostView[] => [withoutEpoch(value)],
    (value: LanguageHostView): LanguageHostView[] => [
      { ...value, status: { ...value.status, languageConnectionEpoch: 0 } },
    ],
    (value: LanguageHostView): LanguageHostView[] => [value, value],
  ]) {
    let hosts = [host()];
    const connections = new RendererLanguageConnections(() => hosts);
    const previous = connections.connection("fake");
    hosts = change(host());
    connections.refresh();
    expect(connections.connection("fake")).toBeNull();
    expect(previous?.signal.aborted).toBe(true);
    connections.dispose();
  }
});

test("old Host with no Main epoch never creates a freshness token; disposal is final", () => {
  const old = host();

  const connections = new RendererLanguageConnections(() => [withoutEpoch(old)]);

  expect(connections.keys()).toEqual([]);
  connections.dispose();
  expect(connections.connection("fake")).toBeNull();
});
