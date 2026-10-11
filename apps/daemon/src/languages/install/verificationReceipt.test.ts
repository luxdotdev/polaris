import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { chmod, readFile, rm, symlink, utimes, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fixture, hostId, platform } from "./fixture.testing.ts";
import { createVersionStorage } from "./storage.ts";
import { defaultLimits } from "./types.ts";

test("successful verification is reused across opens and Daemon restarts, without descriptor aliasing", async () => {
  const f = await fixture();

  try {
    const installed = await f.installer.install(f.request).result;

    const results = await Promise.all(
      Array.from({ length: 8 }, () => f.installer.current("fake-tool"))
    );

    expect(f.installer.stats().verification.fullVerifications).toBe(1);
    expect(results[0]).not.toBe(results[1]);

    const restarted = await createVersionStorage(join(f.parent, "private"), defaultLimits, {
      hostId,
      platform,
    });

    expect(await restarted.current("fake-tool")).toEqual(installed);
    expect(restarted.stats()).toMatchObject({ fullVerifications: 0, receiptReuses: 1 });
    await restarted.current("fake-tool");
    expect(restarted.stats()).toMatchObject({ fullVerifications: 0, memoryReuses: 1 });

    const bounded = await createVersionStorage(
      join(f.parent, "private"),
      { ...defaultLimits, fileBytes: 1 },
      { hostId, platform }
    );

    await rejects(bounded.current("fake-tool"), { reason: "install-failed" });
    await writeFile(join(dirname(installed.directory), "verification.json"), "invalid");

    const missingCertificate = await createVersionStorage(
      join(f.parent, "private"),
      defaultLimits,
      { hostId, platform }
    );

    await missingCertificate.current("fake-tool");
    expect(missingCertificate.stats().fullVerifications).toBe(1);
  } finally {
    await f.close();
  }
});

for (const mutation of ["bytes", "mode", "extra", "symlink", "receipt"] as const)
  test(`verified receipts invalidate after ${mutation} changes and failed checks can recover`, async () => {
    const f = await fixture();

    try {
      const installed = await f.installer.install(f.request).result;
      const file = join(installed.directory, "bin/tool");
      const bytes = await readFile(file);
      const info = await stat(file);
      const receiptPath = join(dirname(installed.directory), "receipt.json");
      const receipt = await readFile(receiptPath);
      const extra = join(installed.directory, "bin/extra");

      if (mutation === "bytes") {
        await writeFile(file, Buffer.alloc(bytes.length, 120));
        await utimes(file, info.atime, info.mtime);
      } else if (mutation === "mode") await chmod(file, 0o644);
      else if (mutation === "extra") await writeFile(extra, "extra");
      else if (mutation === "symlink") await symlink(file, extra);
      else await writeFile(receiptPath, "{}");
      await rejects(f.installer.current("fake-tool"));

      const restarted = await createVersionStorage(join(f.parent, "private"), defaultLimits, {
        hostId,
        platform,
      });

      await rejects(restarted.current("fake-tool"));
      await rm(extra, { force: true });
      await writeFile(file, bytes);
      await chmod(file, info.mode & 0o777);
      await writeFile(receiptPath, receipt);
      expect(await f.installer.current("fake-tool")).toEqual(installed);
      expect(f.installer.stats().verification.fullVerifications).toBeGreaterThan(1);
    } finally {
      await f.close();
    }
  });
