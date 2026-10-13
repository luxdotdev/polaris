import { describe, expect, test } from "bun:test";
import {
  decodeWslOutput,
  looksUtf16le,
  stripUtf16Nuls,
  wslEnv,
  wslStderrDecoder,
} from "./output.ts";

const utf16 = (text: string) => new Uint8Array(Buffer.from(text, "utf16le"));

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("wsl.exe output", () => {
  test("sniffs UTF-16LE by its NUL high bytes", () => {
    expect(looksUtf16le(utf16("  NAME  STATE  VERSION\r\n"))).toBe(true);
    expect(looksUtf16le(utf8("polaris bridge: no Daemon is running\n"))).toBe(false);
    expect(looksUtf16le(new Uint8Array([0x41]))).toBe(false);
    expect(looksUtf16le(new Uint8Array(0))).toBe(false);
  });

  test("decodes UTF-16LE with or without a BOM, and UTF-8 as is", () => {
    expect(decodeWslOutput(utf16("* Ubuntu  Running  2"))).toBe("* Ubuntu  Running  2");
    expect(decodeWslOutput(utf16("﻿Debian"))).toBe("Debian");
    expect(decodeWslOutput(utf8("héllo wörld"))).toBe("héllo wörld");
  });

  test("the stderr decoder takes UTF-16LE and UTF-8 chunks on one pipe", () => {
    const decode = wslStderrDecoder();
    const first = decode(utf16("There is no distribution with the supplied name.\r\n"));
    const second = decode(utf8("polaris bridge: no Daemon is running on this Host\n"));
    expect(first).toBe("There is no distribution with the supplied name.\r\n");
    expect(second).toBe("polaris bridge: no Daemon is running on this Host\n");
  });

  test("a UTF-8 code point split across chunks survives", () => {
    const decode = wslStderrDecoder();
    const bytes = utf8("é");
    expect(decode(bytes.slice(0, 1)) + decode(bytes.slice(1))).toBe("é");
  });

  test("strips the NULs of a UTF-16LE message read as UTF-8", () => {
    expect(stripUtf16Nuls("E\u0000r\u0000r\u0000")).toBe("Err");
    expect(stripUtf16Nuls("plain")).toBe("plain");
  });

  test("the spawn environment asks for UTF-8", () => {
    expect(wslEnv({ PATH: "/bin" })).toEqual({ PATH: "/bin", WSL_UTF8: "1" });
  });
});
