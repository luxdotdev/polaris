import { describe, expect, test } from "bun:test";
import { encodeLinkEnvelope, HostId, type LinkEnvelope } from "@polaris/protocol";
import { type LinkOutcome, type LinkStep, linking, NOT_A_LINK, NOT_SAVED } from "./linking.ts";
import { LINKED_DWELL_MS } from "./model.ts";

const host = (hostName: string): LinkEnvelope["hosts"][number] => ({
  hostId: HostId.make(hostName),
  hostName,
  relayUrl: "wss://relay.polaris.dev/v1",
  // SAFETY: RelayAddress is 22 base64url characters; the brand isn't exported for tests.
  hostAddress: "a".repeat(22) as LinkEnvelope["link"]["hostAddress"],
  hostNoiseKey: "b".repeat(43),
});

/** mac-studio's link, sharing lucas-rpi. */
const LINK = encodeLinkEnvelope({
  link: { ...host("mac-studio"), secret: "c".repeat(43), expiresAt: "2026-10-29T12:00:00.000Z" },
  hosts: [host("lucas-rpi")],
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const harness = (onLink: (link: string) => Promise<LinkOutcome>) => {
  const steps: LinkStep[] = [];
  const links: string[] = [];
  const moved: string[][] = [];
  const timers: Array<{ readonly run: () => void; readonly ms: number }> = [];

  const machine = linking({
    onLink: (link) => {
      links.push(link);

      return onLink(link);
    },
    onStep: (step) => steps.push(step),
    onLinked: (hosts) => moved.push(hosts.map((h) => h.hostName)),
    later: (run, ms) => timers.push({ run, ms }),
  });

  return { machine, steps, links, moved, timers };
};

describe("linking", () => {
  test("a stray QR code is ignored while scanning, but a pasted one is refused", () => {
    const { machine, steps, links } = harness(() => Promise.resolve({ linked: true, hosts: [] }));

    machine.submit("https://example.com");
    expect(steps).toEqual([]);

    machine.show("paste");
    machine.submit("https://example.com");
    expect(steps.at(-1)).toEqual({ kind: "failed", message: NOT_A_LINK });
    expect(links).toEqual([]);
  });

  test("the scanner firing again during a link uses the link once", async () => {
    const { machine, steps, links } = harness(() =>
      Promise.resolve({ linked: true, hosts: [host("mac-studio"), host("lucas-rpi")] })
    );

    machine.submit(LINK);
    machine.submit(LINK);
    machine.show("scan");
    await settle();

    expect(links).toHaveLength(1);
    expect(steps).toEqual([
      { kind: "linking", hostName: "mac-studio", hosts: ["mac-studio", "lucas-rpi"] },
      { kind: "linked", hostName: "mac-studio", hosts: ["mac-studio", "lucas-rpi"] },
    ]);
  });

  test("the app moves on by itself only after Linked this iPhone has stood", async () => {
    const { machine, moved, timers } = harness(() =>
      Promise.resolve({ linked: true, hosts: [host("mac-studio"), host("lucas-rpi")] })
    );

    machine.submit(LINK);
    await settle();
    expect(moved).toEqual([]);
    expect(timers.map((timer) => timer.ms)).toEqual([LINKED_DWELL_MS]);

    for (const timer of timers) timer.run();
    expect(moved).toEqual([["mac-studio", "lucas-rpi"]]);
  });

  test("a refused link shows the relay's message and can be tried again", async () => {
    const { machine, steps, links } = harness(() =>
      Promise.resolve({ linked: false, message: "This link has expired." })
    );

    machine.submit(LINK);
    await settle();
    expect(steps.at(-1)).toEqual({ kind: "failed", message: "This link has expired." });

    machine.submit(LINK);
    await settle();
    expect(links).toHaveLength(2);
  });

  test("a Keychain failure says the link wasn't saved", async () => {
    const { machine, steps } = harness(() =>
      Promise.reject(new Error("errSecInteractionNotAllowed"))
    );

    machine.submit(LINK);
    await settle();
    expect(steps.at(-1)).toEqual({ kind: "failed", message: NOT_SAVED });
  });
});
