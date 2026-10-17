import { describe, expect, test } from "bun:test";
import {
  PIPE_MODE,
  pipeOpenMode,
  pipeSecurityDescriptor,
  rejectsRemoteClients,
} from "./security.ts";

const SID = "S-1-5-21-983044870-2979398100-2557065914-1001";

describe("the pipe's security descriptor", () => {
  test("only the user is granted access, and nothing is inherited", () => {
    expect(pipeSecurityDescriptor(SID)).toBe(`O:${SID}D:P(A;;GA;;;${SID})`);
  });

  test.each(["", "BA", "WD", `${SID})(A;;GA;;;WD`, "S-1-5"])(
    "%p is refused rather than written into the DACL",
    (sid) => {
      expect(() => pipeSecurityDescriptor(sid)).toThrow("not a SID");
    }
  );
});

describe("the pipe's flags", () => {
  test("every instance refuses clients from another machine", () => {
    expect(rejectsRemoteClients(PIPE_MODE)).toBe(true);
    expect(rejectsRemoteClients(0)).toBe(false);
  });

  test("only the first instance claims the name, so a squatter's pipe fails it", () => {
    const FIRST_PIPE_INSTANCE = 0x0008_0000;

    expect(pipeOpenMode(true) & FIRST_PIPE_INSTANCE).toBe(FIRST_PIPE_INSTANCE);
    expect(pipeOpenMode(false) & FIRST_PIPE_INSTANCE).toBe(0);
  });
});
