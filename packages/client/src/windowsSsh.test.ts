import { expect, test } from "bun:test";
import { classifyExit } from "./failures.ts";
import { classifySshFailure } from "./install/Ssh.ts";

// Diagnostic sources and pinned source lines: Desktop machines README, Windows OpenSSH.
test.each([
  [
    "No ED25519 host key is known for pi and you have requested strict checking.\r\nHost key verification failed.",
    "host-key-unknown",
    "host-key",
  ],
  [
    "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\nHost key verification failed.",
    "host-key-changed",
    "host-key",
  ],
  ["pi: Permission denied (publickey,password,keyboard-interactive).", "auth-failed", "auth"],
  ["ssh: Could not resolve hostname pi: No such host is known.", "unreachable", "unreachable"],
  ["channel 0: open failed: connect failed: No such host is known.", "unreachable", "unreachable"],
  ["ssh: connect to host pi port 22: Connection timed out", "timeout", "unreachable"],
] as const)("Windows diagnostic: %s", (stderr, reason, installFailure) => {
  expect(classifyExit({ code: 255, signal: null, stderr }).reason).toBe(reason);
  expect(classifySshFailure(stderr)).toBe(installFailure);
});

test.each([
  "Bad owner or permissions on C:\\Users\\Lucas/.ssh/config",
  "C:\\Users\\Lucas/.ssh/config: line 1: Bad configuration option: wrongoption",
  "WARNING: UNPROTECTED PRIVATE KEY FILE!",
])("Windows config failure requires attention: %s", (stderr) => {
  expect(classifyExit({ code: 255, signal: null, stderr }).reason).toBe("ssh-config-error");
});
