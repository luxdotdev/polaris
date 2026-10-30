import { afterEach, describe, expect, test } from "bun:test";
import { type AddressInfo, connect, createServer } from "node:net";
import { type Cause, Effect, Queue, Stream } from "effect";
import { PROXY_USER, type ProxyStatus } from "./proxy.ts";
import {
  type HostAddressTransport,
  lookupOutside,
  type ProxyServer,
  startProxyServer,
  type Target,
} from "./server.ts";

const isHostAddress = (name: string) =>
  /(^|\.)localhost\.?$/i.test(name) || name.startsWith("127.") || name === "::1";

/**
 * A Host side that records what it was sent and echoes it back in upper case, ending after
 * "BYE"; `written` is every byte the Host received.
 */
const echoTransport = (written: Array<string>) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Uint8Array, Cause.Done>();

    const transport: HostAddressTransport = {
      incoming: Stream.fromQueue(queue),
      write: (bytes) =>
        Effect.gen(function* () {
          const text = Buffer.from(bytes).toString();

          written.push(text);
          yield* Queue.offer(queue, Buffer.from(text.toUpperCase()));

          if (text.includes("BYE")) yield* Queue.end(queue);
        }),
    };

    return transport;
  });

let server: ProxyServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

interface Start {
  readonly opened?: Array<Target>;
  readonly written?: Array<string>;
  readonly fail?: ProxyStatus;
  readonly direct?: Array<string>;
  readonly directPort?: number;
  readonly handshakeTimeoutMs?: number;
  readonly maxConnections?: number;
}

const start = async (options: Start = {}) => {
  const proxy = await startProxyServer<never>({
    isHostAddress,
    run: (effect) => Effect.runFork(effect),
    open: (target) => {
      options.opened?.push(target);

      return options.fail === undefined
        ? echoTransport(options.written ?? [])
        : Effect.fail(options.fail);
    },
    connectDirect: (hostname, port) => {
      options.direct?.push(`${hostname}:${port}`);

      return connect(options.directPort ?? port, "127.0.0.1");
    },
    handshakeTimeoutMs: options.handshakeTimeoutMs,
    maxConnections: options.maxConnections,
  });

  server = proxy;

  return proxy;
};

const basic = (password: string) =>
  `Proxy-Authorization: Basic ${Buffer.from(`${PROXY_USER}:${password}`).toString("base64")}`;

/** Sends `text` as the browser would, and collects everything until the proxy closes. */
const exchange = (port: number, text: string, waitMs = 500) =>
  new Promise<{ readonly received: string; readonly closedAt: number }>((resolve) => {
    const began = Date.now();
    const socket = connect(port, "127.0.0.1", () => socket.write(text));
    let received = "";

    socket.on("data", (chunk) => {
      received += Buffer.from(chunk).toString("latin1");
    });
    // A reset still ends in "close", with what arrived before it.
    socket.on("error", () => {});
    socket.on("close", () => resolve({ received, closedAt: Date.now() - began }));
    setTimeout(() => socket.end(), waitMs);
  });

const statusOf = (received: string) => received.slice(0, received.indexOf("\r\n"));

describe("the proxy's credential", () => {
  test.each([
    ["no credential", (_secret: string) => ""],
    [
      "a wrong secret",
      (secret: string) => `${basic(secret.replace(/^./, (c) => (c === "A" ? "B" : "A")))}\r\n`,
    ],
    ["the credential twice", (secret: string) => `${basic(secret)}\r\n${basic(secret)}\r\n`],
    [
      "another user",
      (secret: string) => `Proxy-Authorization: Basic ${btoa(`root:${secret}`)}\r\n`,
    ],
  ])("%s gets a 407 asking for Basic, and nothing is opened", async (_name, header) => {
    const opened: Array<Target> = [];
    const proxy = await start({ opened });

    const { received } = await exchange(
      proxy.port,
      `CONNECT app.localhost:443 HTTP/1.1\r\nHost: app.localhost:443\r\n${header(proxy.secret)}\r\nhello`
    );

    expect(statusOf(received)).toBe("HTTP/1.1 407 Proxy Authentication Required");
    expect(received).toContain('Proxy-Authenticate: Basic realm="Polaris"');
    expect(opened).toEqual([]);
  });

  test("a garbled request without the credential gets the 407, not a parse error", async () => {
    const proxy = await start();

    const { received } = await exchange(proxy.port, "NONSENSE\r\n\r\n");

    expect(statusOf(received)).toBe("HTTP/1.1 407 Proxy Authentication Required");
  });

  test("each server has its own secret", async () => {
    const first = await start();

    const second = await startProxyServer<never>({
      isHostAddress,
      run: (effect) => Effect.runFork(effect),
      open: () => Effect.fail(502),
    });

    await second.close();
    expect(first.secret).not.toBe(second.secret);
    expect(first.secret.length).toBeGreaterThanOrEqual(32);
  });
});

describe("the proxy's routes", () => {
  test("a CONNECT to a Host address reaches the Host with its hostname as sent, both ways", async () => {
    const opened: Array<Target> = [];
    const proxy = await start({ opened });

    const { received } = await exchange(
      proxy.port,
      `CONNECT App.localhost:443 HTTP/1.1\r\n${basic(proxy.secret)}\r\n\r\nhello bye`
    );

    expect(opened).toEqual([{ hostname: "App.localhost", port: 443 }]);
    expect(received).toBe("HTTP/1.1 200 Connection Established\r\n\r\nHELLO BYE");
  });

  test("an http request goes to the Host in origin form, without the credential or anything after its body", async () => {
    const opened: Array<Target> = [];
    const written: Array<string> = [];
    const proxy = await start({ opened, written });

    await exchange(
      proxy.port,
      [
        "POST http://localhost:5173/api?q=1 HTTP/1.1",
        "Host: localhost:5173",
        basic(proxy.secret),
        "Proxy-Connection: keep-alive",
        "Content-Length: 3",
        "",
        "byeGET http://other.localhost/ HTTP/1.1",
      ].join("\r\n")
    );

    expect(opened).toEqual([{ hostname: "localhost", port: 5173 }]);
    expect(written.join("")).toBe(
      "POST /api?q=1 HTTP/1.1\r\nHost: localhost:5173\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbye"
    );
  });

  test("a loopback IP CONNECT goes to the Host as its address text", async () => {
    const opened: Array<Target> = [];
    const proxy = await start({ opened });

    await exchange(proxy.port, `CONNECT [::1]:3000 HTTP/1.1\r\n${basic(proxy.secret)}\r\n\r\nbye`);

    expect(opened).toEqual([{ hostname: "::1", port: 3000 }]);
  });

  test.each([
    ["a CONNECT to an IP outside loopback", "CONNECT 10.0.0.1:80 HTTP/1.1"],
    ["an http request to the unspecified address", "GET http://0.0.0.0/ HTTP/1.1"],
  ])("%s is refused, never opened nor connected from here", async (_name, line) => {
    const opened: Array<Target> = [];
    const direct: Array<string> = [];
    const proxy = await start({ opened, direct });

    const { received } = await exchange(proxy.port, `${line}\r\n${basic(proxy.secret)}\r\n\r\n`);

    expect(statusOf(received)).toBe("HTTP/1.1 403 Forbidden");
    expect([opened, direct]).toEqual([[], []]);
  });

  test("a direct name that resolves to this machine is refused, not loaded from its loopback", async () => {
    const error = await new Promise((resolve) =>
      lookupOutside("localhost", { all: true }, (failure) => resolve(failure?.code))
    );

    expect(error).toBe("ELOOPBACK");
  });

  test("any other name loads directly from this machine, not from the Host", async () => {
    const site = createServer((socket) => socket.end("from this machine"));

    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));

    // SAFETY: a TCP server listening on a port reports an AddressInfo.
    const address = site.address() as AddressInfo;
    const opened: Array<Target> = [];
    const direct: Array<string> = [];
    const proxy = await start({ opened, direct, directPort: address.port });

    const { received } = await exchange(
      proxy.port,
      `CONNECT printer2:80 HTTP/1.1\r\n${basic(proxy.secret)}\r\n\r\n`
    );

    site.close();
    expect([opened, direct]).toEqual([[], ["printer2:80"]]);
    expect(received).toBe("HTTP/1.1 200 Connection Established\r\n\r\nfrom this machine");
  });

  test("a stream that won't open answers with its status and closes", async () => {
    const proxy = await start({ fail: 504 });

    const { received } = await exchange(
      proxy.port,
      `CONNECT localhost:5173 HTTP/1.1\r\n${basic(proxy.secret)}\r\n\r\n`
    );

    expect(statusOf(received)).toBe("HTTP/1.1 504 Gateway Timeout");
  });
});

describe("the proxy's limits", () => {
  test("a connection that never sends a request is closed after the handshake timeout", async () => {
    const proxy = await start({ handshakeTimeoutMs: 100 });

    const { received, closedAt } = await exchange(proxy.port, "CONNECT app.localhost:443", 2_000);

    expect(received).toBe("");
    expect(closedAt).toBeLessThan(1_000);
  });

  test("connections past the cap are closed unread", async () => {
    const opened: Array<Target> = [];
    const proxy = await start({ opened, maxConnections: 1 });
    const held = connect(proxy.port, "127.0.0.1");

    await new Promise((resolve) => held.once("connect", resolve));

    const { received, closedAt } = await exchange(
      proxy.port,
      `CONNECT app.localhost:443 HTTP/1.1\r\n${basic(proxy.secret)}\r\n\r\n`,
      2_000
    );

    held.destroy();
    expect([received, opened]).toEqual(["", []]);
    expect(closedAt).toBeLessThan(1_000);
  });
});
