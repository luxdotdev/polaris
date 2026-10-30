import { afterEach, describe, expect, test } from "bun:test";
import { connect, createServer, type Socket } from "node:net";
import { Effect, Predicate, Queue, Stream } from "effect";
import {
  type HostAddressTransport,
  lookupOutside,
  type SocksServer,
  startSocksServer,
} from "./server.ts";
import { SocksReply } from "./socks.ts";

const isHostAddress = (name: string) =>
  /(^|\.)localhost\.?$/i.test(name) || name.startsWith("127.") || name === "::1";

/** A Host side that echoes every byte back in upper case, then ends after "BYE". */
const echoTransport = Effect.gen(function* () {
  const queue = yield* Queue.unbounded<Uint8Array, Queue.Done>();

  const transport: HostAddressTransport = {
    incoming: Stream.fromQueue(queue),
    write: (bytes) =>
      Effect.gen(function* () {
        const text = Buffer.from(bytes).toString().toUpperCase();

        yield* Queue.offer(queue, Buffer.from(text));

        if (text.includes("BYE")) yield* Queue.end(queue);
      }),
  };

  return transport;
});

let server: SocksServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

interface Opened {
  readonly hostname: string;
  readonly port: number;
}

const start = async (options: {
  readonly opened?: Array<Opened>;
  readonly fail?: SocksReply;
  readonly direct?: Array<string>;
  readonly directPort?: number;
}) => {
  server = await startSocksServer({
    isHostAddress,
    run: (effect) => Effect.runFork(effect),
    open: (target) => {
      options.opened?.push(target);

      return options.fail === undefined ? echoTransport : Effect.fail(options.fail);
    },
    connectDirect: (hostname, port) => {
      options.direct?.push(`${hostname}:${port}`);

      return connect(options.directPort ?? port, "127.0.0.1");
    },
  });

  return server.port;
};

/** A SOCKS5 client as Chromium is one: no-auth greeting, then CONNECT, then `payload`. */
const socks = (port: number, target: Uint8Array, payload: string) =>
  new Promise<{ readonly reply: number; readonly body: string; readonly ended: boolean }>(
    (resolve, reject) => {
      const socket: Socket = connect(port, "127.0.0.1");
      let received = Buffer.alloc(0);
      let ended = false;

      socket.on("connect", () => socket.write(Uint8Array.of(5, 1, 0)));
      socket.on("data", (chunk) => {
        const first = received.length === 0;

        received = Buffer.concat([received, chunk]);

        if (first && received.length >= 2)
          socket.write(new Uint8Array([...target, ...Buffer.from(payload)]));
      });
      socket.on("end", () => {
        ended = true;
      });
      socket.on("error", reject);
      socket.on("close", () =>
        resolve({
          reply: received[3] ?? -1,
          body: received.subarray(2 + 10).toString(),
          ended,
        })
      );
      setTimeout(() => socket.end(), 500);
    }
  );

const domain = (hostname: string, port: number) =>
  Uint8Array.of(5, 1, 0, 3, hostname.length, ...Buffer.from(hostname), port >> 8, port & 0xff);

describe("the SOCKS server", () => {
  test("a Host address reaches the Host with its hostname as sent, and bytes flow both ways", async () => {
    const opened: Array<Opened> = [];
    const port = await start({ opened });

    const result = await socks(port, domain("App.localhost", 443), "hello bye");

    expect(opened).toEqual([{ hostname: "App.localhost", port: 443 }]);
    expect(result).toEqual({ reply: SocksReply.succeeded, body: "HELLO BYE", ended: true });
  });

  test("a loopback IP CONNECT goes to the Host as its address text", async () => {
    const opened: Array<Opened> = [];
    const port = await start({ opened });

    await socks(
      port,
      Uint8Array.of(5, 1, 0, 4, ...Array<number>(15).fill(0), 1, 0x0b, 0xb8),
      "bye"
    );

    expect(opened).toEqual([{ hostname: "::1", port: 3000 }]);
  });

  test.each([
    ["an IPv4 CONNECT", Uint8Array.of(5, 1, 0, 1, 10, 0, 0, 1, 0, 80)],
    ["an IP literal sent as a name", domain("10.0.0.1", 80)],
    ["the unspecified address sent as a name", domain("0.0.0.0", 80)],
  ])(
    "%s outside loopback is refused, never opened nor connected from here",
    async (_name, target) => {
      const opened: Array<Opened> = [];
      const direct: Array<string> = [];
      const port = await start({ opened, direct });

      const result = await socks(port, target, "x");

      expect(result.reply).toBe(SocksReply.notAllowed);
      expect([opened, direct]).toEqual([[], []]);
    }
  );

  test("a direct name that resolves to this machine is refused, not loaded from its loopback", async () => {
    const error = await new Promise((resolve) =>
      lookupOutside("localhost", { all: true }, (failure) => resolve(failure?.code))
    );

    expect(error).toBe("ELOOPBACK");
  });

  test("any other name loads directly from this machine, not from the Host", async () => {
    const site = createServer((socket) => socket.end("from this machine"));

    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));

    const address = site.address();

    const opened: Array<Opened> = [];

    const direct: Array<string> = [];

    const port = await start({
      opened,
      direct,
      directPort: Predicate.isObject(address) ? address.port : 0,
    });

    const result = await socks(port, domain("printer2", 80), "GET /");

    site.close();
    expect([opened, direct]).toEqual([[], ["printer2:80"]]);
    expect(result).toMatchObject({ reply: SocksReply.succeeded, body: "from this machine" });
  });

  test("a stream that won't open answers with its reply and closes", async () => {
    const port = await start({ fail: SocksReply.connectionRefused });

    const result = await socks(port, domain("localhost", 5173), "GET /");

    expect(result).toEqual({ reply: SocksReply.connectionRefused, body: "", ended: true });
  });
});
