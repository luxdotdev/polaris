import { describe, expect, test } from "bun:test";
import { Parsed, parseGreeting, parseRequest, SocksReply, SocksTarget } from "./socks.ts";

const domainRequest = (hostname: string, port: number) =>
  Uint8Array.of(5, 1, 0, 3, hostname.length, ...Buffer.from(hostname), port >> 8, port & 0xff);

const tagOf = (parsed: Parsed<unknown>) => parsed._tag;

describe("parseGreeting", () => {
  test("waits for every offered method, then says whether no-auth is among them", () => {
    const greeting = Uint8Array.of(5, 2, 0x02, 0x00);

    for (let n = 0; n < greeting.length; n++)
      expect(tagOf(parseGreeting(greeting.subarray(0, n)))).toBe("NeedMore");
    expect(parseGreeting(greeting)).toEqual(Parsed.Done({ value: true, rest: new Uint8Array() }));
    expect(parseGreeting(Uint8Array.of(5, 1, 0x02))).toMatchObject({ value: false });
  });

  test("a SOCKS4 client gets no reply", () => {
    expect(parseGreeting(Uint8Array.of(4, 1, 0, 80, 127, 0, 0, 1, 0))).toEqual(
      Parsed.Invalid({ reply: null })
    );
  });
});

describe("parseRequest", () => {
  test("a domain CONNECT split anywhere keeps its hostname as sent and the bytes after it", () => {
    const request = domainRequest("App.localhost", 443);
    const pipelined = Uint8Array.of(0x16, 0x03, 0x01);
    const bytes = new Uint8Array([...request, ...pipelined]);

    for (let n = 0; n < request.length; n++)
      expect(tagOf(parseRequest(bytes.subarray(0, n)))).toBe("NeedMore");
    expect(parseRequest(bytes)).toEqual(
      Parsed.Done({
        value: SocksTarget.Domain({ hostname: "App.localhost", port: 443 }),
        rest: pipelined,
      })
    );
  });

  test.each([
    ["IPv4", [1, 127, 0, 0, 1], "127.0.0.1"],
    ["IPv6 loopback", [4, ...Array<number>(15).fill(0), 1], "::1"],
    [
      "IPv4-mapped loopback, spelled as Chromium spells it",
      [4, ...Array<number>(10).fill(0), 0xff, 0xff, 127, 0, 0, 1],
      "::ffff:7f00:1",
    ],
  ])("an %s CONNECT gives its canonical text", (_name, target, address) => {
    expect(parseRequest(Uint8Array.of(5, 1, 0, ...target, 0x0b, 0xb8))).toEqual(
      Parsed.Done({ value: SocksTarget.Ip({ address, port: 3000 }), rest: new Uint8Array() })
    );
  });

  test.each([
    ["BIND", Uint8Array.of(5, 2, 0, 1, 127, 0, 0, 1, 0, 80), SocksReply.commandNotSupported],
    [
      "an unknown address type",
      Uint8Array.of(5, 1, 0, 9, 0, 0),
      SocksReply.addressTypeNotSupported,
    ],
    ["port 0", domainRequest("localhost", 0), SocksReply.notAllowed],
    ["a name with a space", domainRequest("a b.localhost", 80), SocksReply.notAllowed],
    ["an empty name", domainRequest("", 80), SocksReply.notAllowed],
  ])("%s is refused", (_name, bytes, reply) => {
    expect(parseRequest(bytes)).toEqual(Parsed.Invalid({ reply }));
  });
});
