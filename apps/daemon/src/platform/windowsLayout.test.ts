import { describe, expect, test } from "bun:test";
import {
  environmentBlock,
  parseJobPids,
  parseTcpListeners,
  privateSddl,
  quoteWindowsArg,
  windowsCommandLine,
} from "./windowsLayout.ts";

/** A `MIB_TCPTABLE_OWNER_PID` as Windows lays it out: address and port in network order. */
const tcpTable = (rows: ReadonlyArray<readonly [string, number, number]>, count = rows.length) => {
  const view = new DataView(new ArrayBuffer(4 + rows.length * 24));
  view.setUint32(0, count, true);

  rows.forEach(([address, port, pid], index) => {
    const at = 4 + index * 24;
    view.setUint32(at, 2, true); // MIB_TCP_STATE_LISTEN
    address.split(".").forEach((octet, byte) => view.setUint8(at + 4 + byte, Number(octet)));
    view.setUint16(at + 8, port, false);
    view.setUint32(at + 20, pid, true);
  });

  return view;
};

describe("the TCP listener table", () => {
  test("holds the 127.0.0.1 listeners, with ports and pids decoded", () => {
    const table = tcpTable([
      ["0.0.0.0", 62300, 77],
      ["127.0.0.1", 62300, 9360],
      ["127.0.0.2", 62301, 5],
      ["127.0.0.1", 443, 4242],
    ]);

    expect(parseTcpListeners(table)).toEqual([
      { port: 62300, pid: 9360 },
      { port: 443, pid: 4242 },
    ]);
  });

  test("never reads past the buffer, whatever the count says", () => {
    expect(parseTcpListeners(tcpTable([["127.0.0.1", 1, 2]], 1000))).toEqual([{ port: 1, pid: 2 }]);
    expect(parseTcpListeners(new DataView(new ArrayBuffer(2)))).toEqual([]);
  });
});

test("a job's process list is read as the pids it lists", () => {
  const view = new DataView(new ArrayBuffer(8 + 3 * 8));
  view.setUint32(0, 3, true);
  view.setUint32(4, 2, true);
  view.setBigUint64(8, 100n, true);
  view.setBigUint64(16, 9360n, true);
  view.setBigUint64(24, 7n, true);

  expect(parseJobPids(view)).toEqual([100, 9360]);
});

describe("a Windows command line", () => {
  test.each([
    ["plain", "plain"],
    ["", '""'],
    ["C:\\Program Files\\codex", '"C:\\Program Files\\codex"'],
    ["C:\\a dir\\", '"C:\\a dir\\\\"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['a\\"b', '"a\\\\\\"b"'],
  ])("splits %p back into the same argument", (arg, quoted) => {
    expect(quoteWindowsArg(arg)).toBe(quoted);
  });

  test("runs an executable directly", () => {
    expect(windowsCommandLine(["C:\\x\\codex.exe", "app-server"], "C:\\W\\cmd.exe")).toEqual({
      application: "C:\\x\\codex.exe",
      commandLine: "C:\\x\\codex.exe app-server",
    });
  });

  test("runs a .cmd shim under cmd, every argument quoted so none is an operator", () => {
    const { application, commandLine } = windowsCommandLine(
      ["C:\\R&D\\codex.cmd", "app-server", "C:\\h\\token"],
      "C:\\W\\cmd.exe"
    );

    expect(application).toBe("C:\\W\\cmd.exe");
    expect(commandLine).toBe(
      'C:\\W\\cmd.exe /d /s /v:off /c ""C:\\R&D\\codex.cmd" "app-server" "C:\\h\\token""'
    );
  });

  test.each(["C:\\%USERNAME%\\token", 'a"b'])(
    "refuses %p, which cmd would expand or split",
    (arg) => {
      expect(() => windowsCommandLine(["C:\\x\\codex.CMD", arg], "cmd.exe")).toThrow("cmd.exe");
    }
  );
});

test("an environment block is sorted name=value strings, ending in an empty one", () => {
  const block = environmentBlock({ Path: "C:\\bin", A: "1", GONE: undefined, "=C:": "C:\\" });

  expect(block.toString("utf16le")).toBe("A=1\0Path=C:\\bin\0\0");
});

describe("a private file's security descriptor", () => {
  const sid = "S-1-5-21-1-2-3-1001";

  test("is owned by the user and grants them alone, nothing inherited", () => {
    expect(privateSddl(sid, "file")).toBe(`O:${sid}D:P(A;;FA;;;${sid})`);
    // A directory passes its one entry down to what is created in it.
    expect(privateSddl(sid, "directory")).toBe(`O:${sid}D:P(A;OICI;FA;;;${sid})`);
  });

  test.each(["", "BA", `${sid})(A;;FA;;;WD`])(
    "refuses %p rather than writing it into the DACL",
    (bad) => {
      expect(() => privateSddl(bad, "file")).toThrow("not a SID");
    }
  );
});
