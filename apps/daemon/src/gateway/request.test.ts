import { expect, test } from "bun:test";
import { admitRequest, hostAllowed, originAllowed } from "./request.ts";

const upgrade = (headers: Record<string, string>, path = "/polaris/rpc", method = "GET") =>
  new Request(`http://127.0.0.1:7477${path}`, {
    method,
    headers: { host: "127.0.0.1:7477", connection: "Upgrade", upgrade: "websocket", ...headers },
  });

test.each([
  ["127.0.0.1:7477", true],
  ["127.0.0.1", true],
  ["localhost:7477", true],
  ["LOCALHOST", true],
  ["studio.tail1234.ts.net", true],
  ["studio.tail1234.ts.net:443", true],
  ["evil.example", false],
  ["evil.example.ts.net.attacker.com", false],
  ["ts.net", false],
  ["127.0.0.1.nip.io", false],
  ["evil.example@127.0.0.1", false],
  ["127.0.0.1/polaris", false],
  ["[::1]:7477", false],
  ["", false],
])("Host %j is allowed: %p", (host, allowed) => {
  expect(hostAllowed(host)).toBe(allowed);
});

test("a missing Host is refused", () => {
  expect(hostAllowed(null)).toBe(false);
});

test.each([
  ["http://127.0.0.1:55660", true],
  ["http://127.0.0.1:55722", true],
  ["http://127.0.0.1", true],
  ["https://127.0.0.1:55660", false],
  ["http://localhost:55660", false],
  ["https://evil.example", false],
  ["https://studio.tail1234.ts.net", false],
  ["null", false],
  ["not a url", false],
  ["http://evil@127.0.0.1:55660", false],
  ["http://127.0.0.1:55660/path", false],
  ["http://127.0.0.1:55660#fragment", false],
])("Origin %j is allowed: %p", (origin, allowed) => {
  expect(originAllowed(origin)).toBe(allowed);
});

test("no Origin header is allowed (an SDK outside a browser)", () => {
  expect(originAllowed(null)).toBe(true);
});

const statusOf = (request: Request, peer: string | null) => {
  const admitted = admitRequest(request, peer);

  return admitted.ok ? admitted.route : admitted.status;
};

test("a request is routed, or refused with the reason that applies first", () => {
  expect(statusOf(upgrade({}), "127.0.0.1")).toBe("rpc");
  expect(statusOf(upgrade({ origin: "http://127.0.0.1:55660" }), null)).toBe("rpc");
  expect(statusOf(upgrade({}, "/polaris/identity", "POST"), "127.0.0.1")).toBe("identity");
  expect(statusOf(upgrade({}), "192.168.1.20")).toBe(403);
  expect(statusOf(upgrade({}, "/polaris"), "127.0.0.1")).toBe(404);
  expect(statusOf(upgrade({}, "/polaris/rpc/"), "127.0.0.1")).toBe(404);
  expect(statusOf(upgrade({}, "/polaris/rpc", "POST"), "127.0.0.1")).toBe(405);
  expect(statusOf(upgrade({}, "/polaris/identity"), "127.0.0.1")).toBe(405);
  expect(statusOf(upgrade({ host: "evil.example" }), "127.0.0.1")).toBe(403);
  expect(
    statusOf(upgrade({ host: "evil.example" }, "/polaris/identity", "POST"), "127.0.0.1")
  ).toBe(403);
  expect(statusOf(upgrade({ origin: "https://evil.example" }), "127.0.0.1")).toBe(403);
});

test("X-Forwarded headers change nothing: the Host and Origin presented are what count", () => {
  const forwarded = {
    "x-forwarded-host": "evil.example",
    "x-forwarded-for": "203.0.113.9",
    "x-forwarded-proto": "https",
  };

  expect(statusOf(upgrade(forwarded), "127.0.0.1")).toBe("rpc");
  expect(statusOf(upgrade({ ...forwarded, host: "studio.tail1234.ts.net" }), "127.0.0.1")).toBe(
    "rpc"
  );
});
