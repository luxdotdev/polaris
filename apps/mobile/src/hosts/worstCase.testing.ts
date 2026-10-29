/**
 * Worst-case Hosts for the Hosts screen and its sheet (break-ui, ENG-559): fully qualified and
 * non-Latin names, multi-line and unbreakable failures, counts of 0, 1 and 1,284, slow round trips.
 */
import type { ConnectionState } from "@polaris/protocol";
import type { HostRoute } from "../runtime/hostConnection.ts";
import type { HostInput } from "./model.ts";

export type DevHostsData = "paper" | "worst" | "offline" | "one" | "huge" | "empty";

const SECOND = 1000;

const MINUTE = 60 * SECOND;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

const host = (
  hostId: string,
  name: string,
  state: ConnectionState,
  more: Partial<HostInput> = {}
): HostInput => ({
  hostId,
  name,
  route: "relay",
  state,
  failure: null,
  latencyMs: state === "connected" ? 12 : null,
  lastSeenAt: null,
  sessions: null,
  ...more,
});

/** A revoked device key: one unbreakable token in a mono well. */
const REVOKED =
  "relay: handshake rejected: device key ed25519:Qm9yZWFsaXMtZGV2aWNlLWtleS0xMjM0NTY3ODkwYWJjZGVmZ2hpams is not trusted by this host (revoked 2026-10-12T08:14:03Z)";

/** What a dev bridge says when the VM it tunnels through went away. */
const SSH_FAILURE = [
  "ssh: connect to host build-vm.internal.northwind-industries-holdings.example.com port 22: Operation timed out",
  "kex_exchange_identification: read: Connection reset by peer",
  "Connection reset by 10.42.0.17 port 22",
].join("\n");

const paper = (at: number): ReadonlyArray<HostInput> => [
  host("lucas-rpi", "lucas-rpi", "reconnecting", {
    failure: "relay: tunnel closed by peer (ECONNRESET)",
    lastSeenAt: at - 42 * SECOND,
    sessions: 3,
  }),
  host("build-vm", "build-vm-ubuntu-2404-arm64", "offline", { lastSeenAt: at - 3 * HOUR }),
  host("mac-studio", "mac-studio", "connected", {
    route: "dev-bridge",
    latencyMs: 4,
    lastSeenAt: at - 2 * HOUR,
    sessions: 6,
  }),
  host("gpu-box", "gpu-box", "connected", {
    latencyMs: 182,
    lastSeenAt: at - 26 * MINUTE,
    sessions: 2,
  }),
];

const worst = (at: number): ReadonlyArray<HostInput> => [
  host(
    "aleksandra",
    "aleksandra-wisniewska-kowalczyk-macbook-pro.taild0d828.ts.net",
    "needs-attention",
    {
      failure: REVOKED,
      lastSeenAt: at - 3 * DAY,
      sessions: 1,
    }
  ),
  host("ci-runner", "build-vm-ubuntu-2404-arm64-northwind-ci-runner-07", "reconnecting", {
    route: "dev-bridge",
    failure: SSH_FAILURE,
    lastSeenAt: at - 59 * SECOND,
    sessions: 1284,
  }),
  host("jo", "jo", "offline", { lastSeenAt: at - 400 * DAY, sessions: 0 }),
  host("lan", "192.168.100.254", "offline", { route: "dev-bridge" }),
  host("lukasz", "Łukasz-Wiśniewski-Mac-Studio.local", "connected", {
    latencyMs: 12_345.6,
    lastSeenAt: at - 31 * DAY,
    sessions: 1,
  }),
  host("tokyo", "東京-render-farm-01", "connected", {
    latencyMs: 0.4,
    lastSeenAt: at - 5 * SECOND,
    sessions: 0,
  }),
  host("gpu", "gpu-box", "connected", { route: "dev-bridge", latencyMs: 182, sessions: null }),
];

const offline = (at: number): ReadonlyArray<HostInput> =>
  worst(at).map((input) => ({ ...input, state: "offline", latencyMs: null }));

const STATES: ReadonlyArray<ConnectionState> = [
  "connected",
  "connected",
  "reconnecting",
  "offline",
  "connected",
  "needs-attention",
];

const ROUTES: ReadonlyArray<HostRoute> = ["relay", "dev-bridge"];

const huge = (at: number): ReadonlyArray<HostInput> =>
  Array.from({ length: 64 }, (_, index) =>
    host(
      `huge-${index}`,
      `northwind-build-agent-${String(index + 1).padStart(2, "0")}`,
      STATES[index % STATES.length] ?? "connected",
      {
        route: ROUTES[index % 2] ?? "relay",
        lastSeenAt: at - index * 7 * MINUTE,
        sessions: index * 3,
        failure: index % 6 === 5 ? REVOKED : null,
      }
    )
  );

export const devHosts = (data: DevHostsData, at: number): ReadonlyArray<HostInput> => {
  switch (data) {
    case "paper":
      return paper(at);
    case "worst":
      return worst(at);
    case "offline":
      return offline(at);
    case "one":
      return [
        host("mac-studio", "mac-studio", "connected", {
          latencyMs: 1,
          lastSeenAt: at - MINUTE,
          sessions: 1,
        }),
      ];
    case "huge":
      return huge(at);
    case "empty":
      return [];
  }
};
