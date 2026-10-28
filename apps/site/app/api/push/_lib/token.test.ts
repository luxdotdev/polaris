import { describe, expect, test } from "bun:test";
import { PREVIEW, PRODUCTION } from "./environment";
import { memoryStore } from "./store";
import { providerTokens, TOKEN_MAX_AGE_MS } from "./token";

describe("provider tokens", () => {
  test("instances sharing a store sign once per issuer, then again after 55 minutes", async () => {
    let now = 0;
    const store = memoryStore(() => now);
    const signs: Array<string> = [];

    const instance = () =>
      providerTokens({
        store,
        now: () => now,
        sleep: async () => {},
        sign: async (issuer) => {
          signs.push(issuer.keyId);

          return `jwt-${signs.length}`;
        },
      });

    const a = instance();
    const b = instance();

    expect((await a.get(PREVIEW.issuer)).token).toBe("jwt-1");
    expect(await b.get(PREVIEW.issuer)).toEqual({ token: "jwt-1", source: "store" });
    expect(await a.get(PREVIEW.issuer)).toEqual({ token: "jwt-1", source: "memory" });
    expect((await b.get(PRODUCTION.issuer)).token).toBe("jwt-2");

    now = TOKEN_MAX_AGE_MS;
    expect((await b.get(PREVIEW.issuer)).token).toBe("jwt-3");
    expect((await a.get(PREVIEW.issuer)).token).toBe("jwt-3");
    expect(signs).toEqual(["NU22YH4SRB", "5L5G3J789G", "NU22YH4SRB"]);
  });

  test("concurrent misses wait for the instance that holds the lock", async () => {
    const store = memoryStore();
    let release = () => {};

    const gate = new Promise<void>((resolve) => (release = resolve));
    let signs = 0;

    const sign = async () => {
      signs++;
      await gate;

      return "jwt-shared";
    };

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms / 10));
    const first = providerTokens({ store, sign, sleep }).get(PREVIEW.issuer);
    const second = providerTokens({ store, sign, sleep }).get(PREVIEW.issuer);
    setTimeout(release, 20);

    expect((await Promise.all([first, second])).map((t) => t.token)).toEqual([
      "jwt-shared",
      "jwt-shared",
    ]);
    expect(signs).toBe(1);
  });

  test("invalidating an old token keeps a newer one another instance stored", async () => {
    const store = memoryStore();
    let n = 0;
    const a = providerTokens({ store, sign: async () => `jwt-${++n}` });
    const b = providerTokens({ store, sign: async () => `jwt-${++n}` });

    await a.get(PREVIEW.issuer);
    await b.invalidate(PREVIEW.issuer, "jwt-1");
    expect((await b.get(PREVIEW.issuer)).token).toBe("jwt-2");
    await a.invalidate(PREVIEW.issuer, "jwt-1");
    expect(
      (await providerTokens({ store, sign: async () => "unused" }).get(PREVIEW.issuer)).token
    ).toBe("jwt-2");
  });
});
