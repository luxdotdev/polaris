import { expect, test } from "bun:test";
import { join } from "node:path";
import { hostSigning } from "./signing.ts";

const HOME = join("/", "home", "lucas");

const global = (key: string, value: string) => ({
  scope: "global",
  origin: "file:/home/lucas/.gitconfig",
  key,
  value,
});

const sshKey = (key: string) =>
  hostSigning([global("gpg.format", "ssh"), global("user.signingkey", key)], HOME);

/** The key Polaris passes git as `-c user.signingKey=…`, or why it refused. */
const passedKey = (key: string) => {
  const signing = sshKey(key);

  return signing.kind === "sign"
    ? signing.pairs.find(([name]) => name === "user.signingKey")?.[1]
    : signing.reason;
};

test("an ssh signing key's ~/ is expanded against the user's home, as older gits don't", () => {
  expect(passedKey("~/.ssh/id_ed25519")).toBe(join(HOME, ".ssh/id_ed25519"));
});

test.each(["~otheruser/key", "~key", ".ssh/id_ed25519", "id_ed25519"])(
  "an ssh signing key %s, which git could resolve in the repository, is refused",
  (key) => {
    expect(sshKey(key)).toEqual({
      kind: "refuse",
      reason: "your git config names a signing key by a relative path",
    });
  }
);

test.each(["key::ssh-ed25519 AAAA", "ssh-ed25519 AAAA"])(
  "a literal ssh key %s is passed as it is",
  (key) => {
    expect(passedKey(key)).toBe(key);
  }
);
