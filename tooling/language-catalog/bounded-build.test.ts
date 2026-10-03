import { test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

test("synthetic source-build deadline, disk, archive and compiler-drift guards", () => {
  execFileSync("python3", [join(import.meta.dir, "bounded_build_test.py")], {
    timeout: 20000,
    stdio: "pipe",
  });
}, 25000);
