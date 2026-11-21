import { expect, test } from "bun:test";
import { readPeerPid } from "./peerCredentials.ts";

test.each(["linux", "darwin"])(
  "%s reads the kernel PID and rejects failed or truncated credentials",
  (platform) => {
    const result = readPeerPid(12, platform, (_fd, level, option, value) => {
      if (platform === "linux" && level === 1 && option === 17) value.set([723, 1000, 1000]);

      if (platform === "darwin" && level === 0 && option === 2) value[0] = 723;

      return 0;
    });

    expect(result).toBe(723);
    expect(() => readPeerPid(12, platform, () => -1)).toThrow("cannot read Unix peer PID");
    expect(() =>
      readPeerPid(12, platform, (_fd, _level, _option, value, length) => {
        value[0] = 723;
        length[0] = 0;

        return 0;
      })
    ).toThrow("cannot read Unix peer PID");
    expect(() => readPeerPid(12, platform, () => 0)).toThrow("cannot read Unix peer PID");
  }
);
