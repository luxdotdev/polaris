import { expect, test } from "bun:test";
import { Schema } from "effect";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as P from "@polaris/protocol";
import { LanguageAccess, decodeLanguage } from "@polaris/client";
import { readSettings, writeSettings, type Settings } from "../settings.ts";
import { createLanguageBridge, LanguagePreferences, type LanguageHost } from "./index.ts";
import { LanguageMedia, imageNetwork, publicImageAddress, type ImageNetwork } from "./media.ts";

const hostId = P.HostId.make("host-a");

const workspaceId = P.WorkspaceId.make("workspace-a");

const checkout = P.LanguageCheckout.cases.Workspace.make({ workspaceId, path: "/fixture" });

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

const prefs = () => {
  let settings: Settings = { theme: "dark" };

  const preferences = new LanguagePreferences(
    () => settings,
    (next) => {
      settings = next;
    }
  );

  return { preferences, current: () => settings };
};

const policy = P.LanguagePreviewPolicy.make({
  ...P.LANGUAGE_EDITOR_DEFAULTS,
  hostId,
  workspaceId,
  externalImages: "allow",
});

const host = (access: LanguageAccess | null = null): LanguageHost => ({
  hostId,
  access,
  authorizeWorkspace: (id) => id === workspaceId,
  authorizeCheckout: (value) => value.workspaceId === workspaceId && value.path === checkout.path,
});

const network = (overrides: Partial<ImageNetwork> = {}): ImageNetwork => ({
  resolve: async () => ["93.184.216.34"],
  fetch: async () => ({
    status: 200,
    location: null,
    body: (async function* () {
      yield png;
    })(),
    close: () => {},
  }),
  ...overrides,
});

test("atomic validated preferences survive restart with app/Language/Host/Workspace precedence", () => {
  const root = mkdtempSync(join(tmpdir(), "m31-c1-settings-"));
  const path = join(root, "settings.json");

  try {
    writeSettings({ path, settings: { theme: "light" } });

    const preferences = new LanguagePreferences(
      () => readSettings(path),
      (settings) => writeSettings({ path, settings })
    );

    const app = P.LanguageSettingsScope.cases.App.make({});
    const language = P.LanguageSettingsScope.cases.Language.make({ language: "typescript" });
    const hostScope = P.LanguageSettingsScope.cases.Host.make({ hostId });

    const workspace = P.LanguageSettingsScope.cases.Workspace.make({
      hostId,
      workspaceId,
      language: null,
    });

    const local = P.LanguageSettingsScope.cases.Workspace.make({
      hostId,
      workspaceId,
      language: "typescript",
    });

    preferences.set(app, 0, { formatOnSave: false, interpreter: "/app" });
    preferences.set(language, 0, { formatOnSave: true, interpreter: "/language" });
    preferences.set(hostScope, 0, { interpreter: "/host", sdk: "/host-sdk" });
    preferences.set(workspace, 0, { interpreter: "/workspace" });
    preferences.set(local, 0, { interpreter: "/workspace-language" });
    const effective = preferences.effective(hostId, workspaceId, "typescript");
    expect(effective.settings.interpreter).toBe("/workspace-language");
    expect(effective.settings.sdk).toBe("/host-sdk");
    expect(effective.origins.interpreter).toEqual(local);
    expect(effective.formatOnSave).toBe(true);
    expect(preferences.effective(hostId, workspaceId, "python").settings.interpreter).toBe(
      "/workspace"
    );
    expect(readSettings(path).theme).toBe("light");
    const before = readFileSync(path, "utf8");
    expect(() => preferences.set(app, 0, { formatOnSave: true })).toThrow("conflict");
    expect(() => preferences.set(app, 1, { interpreter: "\u0000SECRET" })).toThrow("invalid-input");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(
      new LanguagePreferences(
        () => readSettings(path),
        () => {}
      ).get(local).revision
    ).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed atomic commit leaves preferences at prior revision", () => {
  const settings: Settings = {};

  const preferences = new LanguagePreferences(
    () => settings,
    () => {
      throw new Error("disk failure");
    }
  );

  const scope = P.LanguageSettingsScope.cases.App.make({});
  expect(() => preferences.set(scope, 0, { formatOnSave: false })).toThrow("disk failure");
  expect(preferences.get(scope).revision).toBe(0);
});

test("old/offline Host retains local policy and denies forged Host/Workspace/checkout", async () => {
  const { preferences } = prefs();
  const current = host();
  const bridge = createLanguageBridge({ preferences, lookup: () => current });
  expect((await bridge.request("languages.catalog", { hostKey: "host" })).ok).toBe(false);

  const result = await bridge.request("languages.preview.policy.get", {
    hostKey: "host",
    workspaceId,
  });

  expect(result.ok && result.value.externalImages).toBe("ask");
  expect(
    (
      await bridge.request("languages.preview.policy.set", {
        hostKey: "host",
        policy: { ...policy, hostId: P.HostId.make("foreign") },
      })
    ).ok
  ).toBe(false);
  expect(
    (
      await bridge.request("languages.preview.policy.get", {
        hostKey: "host",
        workspaceId: P.WorkspaceId.make("foreign"),
      })
    ).ok
  ).toBe(false);
  expect(
    (
      await bridge.request("languages.preview.media", {
        hostKey: "host",
        checkout: { ...checkout, path: "/outside" },
        documentPath: "/outside/a.md",
        relativePath: "a.png",
        maxBytes: 100,
      })
    ).ok
  ).toBe(false);
  bridge.dispose();
});

test("external consent is independent per Host and Workspace and blocks before any DNS", async () => {
  const { preferences } = prefs();
  let resolved = 0;

  const media = new LanguageMedia(
    preferences,
    network({
      resolve: async () => {
        resolved++;

        return ["93.184.216.34"];
      },
    })
  );

  await rejected(
    media.external(
      hostId,
      workspaceId,
      "https://example.com/a.png",
      100,
      new AbortController().signal
    ),
    { reason: "not-owner" }
  );
  expect(resolved).toBe(0);
  preferences.setPolicy(policy);
  expect(
    (
      await media.external(
        hostId,
        workspaceId,
        "https://example.com/a.png",
        100,
        new AbortController().signal
      )
    ).mimeType
  ).toBe("image/png");
  await rejected(
    media.external(
      P.HostId.make("host-b"),
      workspaceId,
      "https://example.com/a.png",
      100,
      new AbortController().signal
    ),
    { reason: "not-owner" }
  );
});

test("external images reject private destinations, redirect rebinding, active media and oversized streams", async () => {
  const { preferences } = prefs();
  preferences.setPolicy(policy);

  for (const address of [
    "127.0.0.1",
    "169.254.169.254",
    "10.1.1.1",
    "172.16.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "198.18.1.1",
  ])
    expect(publicImageAddress(address)).toBe(false);
  let fetches = 0;

  const redirect = new LanguageMedia(
    preferences,
    network({
      resolve: async (hostname) =>
        hostname === "private.example" ? ["127.0.0.1"] : ["93.184.216.34"],
      fetch: async () => {
        fetches++;

        return {
          status: 302,
          location: "https://private.example/image",
          body: (async function* () {})(),
          close: () => {},
        };
      },
    })
  );

  await rejected(
    redirect.external(
      hostId,
      workspaceId,
      "https://public.example/a",
      100,
      new AbortController().signal
    ),
    { reason: "not-owner" }
  );
  expect(fetches).toBe(1);

  const svg = new LanguageMedia(
    preferences,
    network({
      fetch: async () => ({
        status: 200,
        location: null,
        body: (async function* () {
          yield new TextEncoder().encode('<svg onload="alert(1)"></svg>');
        })(),
        close: () => {},
      }),
    })
  );

  await rejected(
    svg.external(hostId, workspaceId, "https://example.com/a", 100, new AbortController().signal),
    { reason: "invalid-input" }
  );
  await rejected(
    new LanguageMedia(preferences, network()).external(
      hostId,
      workspaceId,
      "https://example.com/a",
      8,
      new AbortController().signal
    ),
    { reason: "too-large" }
  );
});

test("Host Blob media validates raster signature, length and traversal", async () => {
  const { preferences } = prefs();
  let reads = 0;
  const connection = new AbortController();

  const access = new LanguageAccess({
    hostId,
    clientId: "client",
    capabilities: ["languages.preview-media"],
    signal: connection.signal,
    invoke: async () => {
      reads++;

      return P.LanguagePreviewMedia.make({
        uri: "file:///fixture/a.png",
        mimeType: "image/png",
        bytes: png.length,
        blobId: P.BlobId.make("b1"),
      });
    },
    watch: async function* () {},
    takeBlob: async () => png,
  });

  const media = new LanguageMedia(preferences);
  const input = { checkout, documentPath: "/fixture/a.md", relativePath: "a.png", maxBytes: 100 };
  expect((await media.relative(access, input)).bytes).toBe(png.length);
  await rejected(media.relative(access, { ...input, relativePath: "../secret" }), {
    reason: "invalid-input",
  });
  expect(reads).toBe(1);
  expect(
    (
      await media.relative(access, {
        ...input,
        documentPath: "/fixture/docs/a.md",
        relativePath: "../a.png",
      })
    ).bytes
  ).toBe(png.length);
  expect(reads).toBe(2);
});

test("connection replacement rejects an old result and errors never echo transport secrets", async () => {
  const { preferences } = prefs();
  let complete: ((value: typeof P.LanguageCatalog.Type) => void) | undefined;
  const controller = new AbortController();

  const access = new LanguageAccess({
    hostId,
    clientId: "client",
    capabilities: ["languages"],
    signal: controller.signal,
    invoke: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    watch: async function* () {},
    takeBlob: async () => png,
  });

  let current = host(access);
  const bridge = createLanguageBridge({ preferences, lookup: () => current });

  const result = bridge.request("languages.catalog", { hostKey: "host" });
  await Bun.sleep(0);
  current = host();
  complete?.({ revision: 1, releaseDate: "fixture", tools: [], integrations: [] });
  expect(await result).toEqual({
    ok: false,
    error: { code: "LanguageError", message: "Language operation: not-connected" },
  });
  bridge.dispose();
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Test observes raw transport rejection before asserting its safe fields.
const rejected = async (
  promise: Promise<unknown>,
  expected: Partial<Pick<P.LanguageError, "reason" | "message">>
) => {
  const error = await promise.then(
    () => null,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Captured test rejection is intentionally untrusted.
    (failure: unknown) => failure
  );

  expect(error).toMatchObject(expected);
};

test("main supplies persisted effective Settings instead of renderer launch configuration", async () => {
  const { preferences } = prefs();
  preferences.set(P.LanguageSettingsScope.cases.App.make({}), 0, {
    formatOnSave: false,
    interpreter: "/main/interpreter",
  });
  const effective = preferences.effective(hostId, workspaceId, "typescript");

  const access = new LanguageAccess({
    hostId,
    clientId: "client",
    capabilities: ["languages"],
    signal: new AbortController().signal,
    invoke: async (method, value) => {
      expect(method).toBe("languages.discover");
      const input = decodeLanguage(P.DiscoverLanguageProject.payloadSchema, value);
      expect(input.settings).toEqual(effective);

      return P.LanguageDiscovery.make({
        checkout,
        projectRoot: checkout.path,
        providers: [],
        effectiveSettings: input.settings,
        trust: P.LanguageTrust.make({
          scope: P.LanguageTrustScope.cases.Workspace.make({ hostId, workspaceId }),
          revision: 0,
          trusted: false,
        }),
      });
    },
    watch: async function* () {},
    takeBlob: async () => png,
  });

  const current = host(access);

  const bridge = createLanguageBridge({
    preferences,
    lookup: () => current,
    languageOf: () => "typescript",
  });

  const result = await bridge.request("languages.discover", {
    hostKey: "host",
    checkout,
    path: "/fixture/a.ts",
    documentLanguageId: "typescript",
    settings: {
      ...effective,
      formatOnSave: true,
      settings: { interpreter: "/renderer/untrusted" },
    },
  });

  expect(result.ok).toBe(true);
  bridge.dispose();
});

test("bridge disposal cancels pending external DNS without emitting bytes", async () => {
  const { preferences } = prefs();
  preferences.setPolicy(policy);
  const current = host();

  const bridge = createLanguageBridge({
    preferences,
    lookup: () => current,
    network: network({ resolve: () => new Promise(() => {}) }),
  });

  const pending = bridge.request("languages.preview.external", {
    hostKey: "host",
    workspaceId,
    url: "https://example.com/a.png",
    maxBytes: 100,
  });

  bridge.dispose();
  expect((await pending).ok).toBe(false);
});

test("main bounds concurrent media requests even when renderer requests cannot be aborted", async () => {
  const { preferences } = prefs();
  preferences.setPolicy(policy);
  const current = host();

  const bridge = createLanguageBridge({
    preferences,
    lookup: () => current,
    network: network({ resolve: () => new Promise(() => {}) }),
  });

  const input = { hostKey: "host", workspaceId, url: "https://example.com/a.png", maxBytes: 100 };

  const pending = Array.from({ length: 4 }, () =>
    bridge.request("languages.preview.external", input)
  );

  const overflow = await bridge.request("languages.preview.external", input);
  expect(overflow).toEqual({
    ok: false,
    error: { code: "LanguageError", message: "Language operation: queue-full" },
  });
  bridge.dispose();
  expect((await Promise.all(pending)).every((result) => !result.ok)).toBe(true);
});

test("concrete main HTTP adapter pins address while retaining hostname and omitting credentials", async () => {
  let receivedHost: string | undefined;
  let receivedCookie: string | undefined;
  let receivedAuthorization: string | undefined;

  const server = createServer((request, response) => {
    receivedHost = request.headers.host;
    receivedCookie = request.headers.cookie;
    receivedAuthorization = request.headers.authorization;
    response.writeHead(200, { "content-type": "image/png" });
    response.end(png);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = decodeLanguage(
      Schema.Struct({ port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })) }),
      server.address()
    );

    const response = await imageNetwork.fetch(
      new URL(`http://unresolvable.invalid:${address.port}/a.png`),
      "127.0.0.1",
      AbortSignal.timeout(5000)
    );

    const bytes: Uint8Array[] = [];

    for await (const chunk of response.body) bytes.push(chunk);
    response.close();
    expect(Buffer.concat(bytes)).toEqual(Buffer.from(png));
    expect(receivedHost).toBe(`unresolvable.invalid:${address.port}`);
    expect(receivedCookie).toBeUndefined();
    expect(receivedAuthorization).toBeUndefined();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
  }
});

test("app and per-language preferences work before any Host is configured", async () => {
  const { preferences } = prefs();
  const bridge = createLanguageBridge({ preferences, lookup: () => null });
  const scope = P.LanguageSettingsScope.cases.App.make({});

  const write = await bridge.request("languages.settings.set", {
    hostKey: "app",
    scope,
    expectedRevision: 0,
    settings: { formatOnSave: false },
  });

  expect(write.ok).toBe(true);
  const read = await bridge.request("languages.settings.get", { hostKey: "app", scope });
  expect(read.ok && read.value.settings.formatOnSave).toBe(false);

  const hostWrite = await bridge.request("languages.settings.set", {
    hostKey: "missing",
    scope: P.LanguageSettingsScope.cases.Host.make({ hostId }),
    expectedRevision: 0,
    settings: { formatOnSave: false },
  });

  expect(hostWrite.ok).toBe(false);
  bridge.dispose();
});
