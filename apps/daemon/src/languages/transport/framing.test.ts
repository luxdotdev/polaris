import { expect, test } from "bun:test";
import { LspFramer, encodeFrame } from "./framing.ts";

test("fragmented UTF-8 and coalesced frames retain wire order", () => {
  const frames = Buffer.concat([
    encodeFrame({ jsonrpc: "2.0", method: "one", params: { text: "é😀" } }),
    encodeFrame({ jsonrpc: "2.0", id: 7, result: null }),
  ]);

  for (let split = 1; split < frames.length; split++) {
    const decoder = new LspFramer();

    const messages = [
      ...decoder.push(frames.subarray(0, split)),
      ...decoder.push(frames.subarray(split)),
    ];

    expect(messages).toEqual([
      { jsonrpc: "2.0", method: "one", params: { text: "é😀" } },
      { jsonrpc: "2.0", id: 7, result: null },
    ]);
    decoder.end();
  }
});

test("malformed lengths/JSON/envelopes/encoding and oversized bytes fail closed", () => {
  for (const input of [
    "Content-Length: -1\r\n\r\n",
    "Çontent-Length: 2\r\n\r\n{}",
    "Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
    "Content-Length: 1048577\r\n\r\n",
    "Content-Length: 2\r\n\r\nxx",
    "Content-Length: 2\r\n\r\n{}",
    "Content-Length: 2\r\nContent-Type: application/vscode-jsonrpc; charset=ascii\r\n\r\n{}",
    "X".repeat(9000),
  ]) {
    const decoder = new LspFramer();
    expect(() => decoder.push(Buffer.from(input))).toThrow();
    expect(() => decoder.push(Buffer.from("x"))).toThrow();
  }

  const decoder = new LspFramer();
  decoder.push(Buffer.from("Content-Length: 10\r\n\r\n{"));
  expect(() => decoder.end()).toThrow();
  expect(() => encodeFrame({ jsonrpc: "2.0", id: 1, result: "é".repeat(700000) })).toThrow();
});
