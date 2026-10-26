import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteAccessRow, TAILNET_NOTE } from "./RemoteAccess.tsx";

const HOST = "mac.tail1234.ts.net";

const DISABLED = 'disabled=""';

const render = (status: Parameters<typeof RemoteAccessRow>[0]["status"], busy = false) =>
  renderToStaticMarkup(<RemoteAccessRow status={status} busy={busy} onChange={() => undefined} />);

const off = { state: "off", url: null, hostName: HOST, reason: null } as const;

describe("a host's remote access row", () => {
  test("on, it says where extensions connect and what the tailnet must allow", () => {
    const html = render({ ...off, state: "on", url: `wss://${HOST}/polaris/rpc` });

    expect(html).toContain(`Extensions connect to wss://${HOST}/polaris/rpc`);
    expect(html).toContain(TAILNET_NOTE.replace("'", "&#x27;"));
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain(DISABLED);
  });

  test("unavailable, the switch is disabled and the row says what to do instead", () => {
    const html = render({ ...off, state: "unavailable", reason: "https-disabled" });

    expect(html).toContain("Enable HTTPS certificates for your tailnet");
    expect(html).toContain(DISABLED);
    expect(html).not.toContain(TAILNET_NOTE.replace("'", "&#x27;"));
  });

  test("off without a gateway, the switch is disabled and says the gateway isn't running", () => {
    const html = render({ ...off, reason: "gateway-not-running" });

    expect(html).toContain("The gateway isn&#x27;t running on this host.");
    expect(html).toContain(DISABLED);
  });

  test("on but serving something else, it says so and can still be turned off", () => {
    const html = render({ ...off, state: "on", reason: "serving-elsewhere" });

    expect(html).toContain("Tailscale serves /polaris to something other than this host");
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain(DISABLED);
  });

  test.each(["on", "off"] as const)(
    "Funnel explains the conflict when %s and only permits turning off",
    (state) => {
      const html = render({ ...off, state, reason: "funnel-on" });

      expect(html).toContain(
        "Tailscale Funnel is on for port 443 on this host. Turning on remote access would turn it off, so Polaris leaves it alone."
      );
      expect(html).not.toContain("Extensions connect to");
      expect(html.includes(DISABLED)).toBe(state === "off");
    }
  );

  test("a conflicting listener explains why remote access cannot be enabled", () => {
    const html = render({ ...off, state: "unavailable", reason: "port-in-use" });

    expect(html).toContain(
      "Tailscale already uses port 443 on this host for something else. Stop it before turning on remote access."
    );
    expect(html).toContain(DISABLED);
  });

  test("while loading or switching, the switch can't be flipped again", () => {
    expect(render(null)).toContain(DISABLED);
    expect(render(off, true)).toContain(DISABLED);
    expect(render(off)).not.toContain(DISABLED);
  });
});
