import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { LanguageCheckout, LanguageEffectiveSettings, LanguageError } from "@polaris/protocol";
import { Schema } from "effect";
import {
  canonicalCheckout,
  checkoutKey,
  checkoutPath,
  type CheckoutRegistry,
} from "../trust/index.ts";
import { invalid } from "../trust/checkout.ts";
import { ancestors, isDirectory, nearest, withDiscoveryBudget } from "./files.ts";
import { configPlugins, pluginFacts, typescriptSdk } from "./typescript.ts";
import { projectRoot, prismaFacts, workspaceFacts } from "./roots.ts";
import { pythonInterpreter } from "./python.ts";
import { configurationFingerprint } from "./configuration.ts";

export { effectiveSettings, configurationFingerprint } from "./configuration.ts";

export { ProjectDiscovery } from "./service.ts";

export interface DiscoveryInput {
  checkout: LanguageCheckout;
  path: string;
  providerId: string;
  settings: typeof LanguageEffectiveSettings.Type;
  refresh?: boolean;
}

const family = (provider: string) =>
  ({
    "typescript-language-server": "typescript",
    pyright: "python",
    basedpyright: "python",
    ruff: "python",
    "rust-analyzer": "rust",
    gopls: "go",
    "prisma-language-server": "prisma",
    jdtls: "java",
    phpactor: "php",
    "lua-language-server": "lua",
    "yaml-language-server": "yaml",
    "actions-language-server": "actions",
    "vscode-html-language-server": "html",
    "vscode-css-language-server": "css",
    "bash-language-server": "bash",
    "sqllens-language-server": "sql",
  })[provider] ?? provider;

async function overridePath(root: string, path: string) {
  return realpath(isAbsolute(path) ? path : resolve(root, path));
}

async function sdkFacts(
  root: string,
  project: string,
  provider: string,
  override: string | null | undefined
) {
  if (override != null) {
    const sdk = await overridePath(root, override);

    const tsserver =
      provider === "typescript" ? await overridePath(root, resolve(sdk, "lib/tsserver.js")) : null;

    return { sdk, tsserver, sdkVersion: null };
  }

  const detected = provider === "typescript" ? await typescriptSdk(root, project) : null;

  return {
    sdk: detected?.sdk ?? null,
    tsserver: detected?.server ?? null,
    sdkVersion: detected?.version ?? null,
  };
}

async function interpreterFacts(
  root: string,
  start: string,
  provider: string,
  platform: NodeJS.Platform,
  override: string | null | undefined
) {
  if (override != null) {
    const path = await overridePath(root, override);

    return { interpreter: path, interpreterTarget: path, pythonConfiguration: null };
  }

  const detected = provider === "python" ? await pythonInterpreter(root, start, platform) : null;

  return {
    interpreter: detected?.path ?? null,
    interpreterTarget: detected?.target ?? null,
    pythonConfiguration: detected?.configuration ?? null,
  };
}

async function discover(
  context: Awaited<ReturnType<typeof canonicalCheckout>>,
  path: string,
  input: DiscoveryInput,
  platform: NodeJS.Platform
) {
  const provider = family(input.providerId);
  const settings = Schema.decodeUnknownSync(LanguageEffectiveSettings)(input.settings);
  const custom = settings.settings.customServers?.find(({ id }) => id === input.providerId);
  const start = (await isDirectory(path)) ? path : dirname(path);

  const root =
    custom?.workingDirectory == null
      ? await projectRoot(context.root, start, provider, custom?.rootMarkers)
      : await checkoutPath(context, custom.workingDirectory);

  const configuration =
    provider !== "typescript"
      ? null
      : ((
          await nearest(context.root, ancestors(context.root, start), [
            "tsconfig.json",
            "jsconfig.json",
          ])
        )?.path ?? null);

  const probes =
    settings.settings.pluginProbeRoots === undefined
      ? [root]
      : await Promise.all(
          settings.settings.pluginProbeRoots.map((probe) => checkoutPath(context, probe))
        );

  const names =
    provider === "typescript" && configuration !== null
      ? await configPlugins(context.root, configuration)
      : [];

  const executable = settings.settings.executableOverrides?.[input.providerId] ?? custom?.launch;

  return {
    checkout: context.checkout,
    projectRoot: root,
    providerId: input.providerId,
    configuration: provider === "typescript" ? configuration : null,
    ...(await sdkFacts(context.root, root, provider, settings.settings.sdk)),
    ...(await interpreterFacts(
      context.root,
      start,
      provider,
      platform,
      settings.settings.interpreter
    )),
    pluginProbeRoots: probes,
    plugins: await pluginFacts(context.root, probes, names),
    prisma: provider === "prisma" ? await prismaFacts(context.root, root) : null,
    formatterConfiguration:
      (
        await nearest(context.root, ancestors(context.root, start), [
          "prettier.config.js",
          "prettier.config.cjs",
          "prettier.config.mjs",
          "prettier.config.ts",
          ".prettierrc",
          ".prettierrc.json",
          ".prettierrc.js",
          ".prettierrc.cjs",
          "ruff.toml",
          ".ruff.toml",
          "rustfmt.toml",
          ".rustfmt.toml",
        ])
      )?.path ?? null,
    build: await workspaceFacts(context.root, root, provider),
    executable:
      executable === undefined ? null : await overridePath(context.root, executable.executable),
    environmentKeys: Object.keys(executable?.environment ?? {}).toSorted(),
    effectiveSettings: settings,
  };
}

export type DiscoveryFacts = Awaited<ReturnType<typeof discover>> & {
  configurationFingerprint: string;
  configurationInputs: Record<string, string>;
};

/** Demand-only LRU. No timers, watchers, executable imports, shell lookup or process invocation. */
export function createProjectDiscovery(options: {
  registry: CheckoutRegistry;
  capacity?: number;
  maxPending?: number;
  platform?: NodeJS.Platform;
}) {
  const capacity = options.capacity ?? 128;
  const maxPending = options.maxPending ?? 8;

  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 1024 ||
    !Number.isInteger(maxPending) ||
    maxPending < 1 ||
    maxPending > 32
  ) {
    throw invalid("Invalid discovery cache bounds");
  }

  const cache = new Map<string, DiscoveryFacts>();
  const sizes = new Map<string, number>();
  const maxRetainedBytes = 8388608;
  let retainedBytes = 0;
  let pending = 0;
  let epoch = 0;

  function remove(key: string) {
    retainedBytes -= sizes.get(key) ?? 0;
    sizes.delete(key);
    cache.delete(key);
  }

  async function run(input: DiscoveryInput): Promise<DiscoveryFacts> {
    if (pending >= maxPending)
      throw new LanguageError({
        reason: "queue-full",
        message: "Discovery concurrency limit reached",
        retryable: true,
      });
    pending++;

    if (input.refresh) invalidate();
    const startedEpoch = epoch;

    try {
      const context = await canonicalCheckout(options.registry, input.checkout);
      const path = await checkoutPath(context, input.path);

      const key = configurationFingerprint([
        checkoutKey(context.checkout),
        context.root,
        path,
        input.providerId,
        input.settings,
      ]);

      const cached = cache.get(key);

      if (cached !== undefined && !input.refresh) {
        cache.delete(key);
        cache.set(key, cached);

        return structuredClone(cached);
      }

      remove(key);

      const observed = await withDiscoveryBudget(context.root, () =>
        discover(context, path, input, options.platform ?? process.platform)
      );

      const facts = { ...observed.value, configurationInputs: observed.configurationInputs };

      const result = { ...facts, configurationFingerprint: configurationFingerprint(facts) };
      const size = Buffer.byteLength(JSON.stringify(result));

      if (size > 1048576)
        throw new LanguageError({
          reason: "too-large",
          message: "Discovery result exceeds limit",
          retryable: false,
        });

      if (startedEpoch === epoch) {
        remove(key);

        while (cache.size >= capacity || retainedBytes + size > maxRetainedBytes)
          remove(cache.keys().next().value!);
        cache.set(key, result);
        sizes.set(key, size);
        retainedBytes += size;
      }

      return structuredClone(result);
    } finally {
      pending--;
    }
  }

  function invalidate() {
    epoch++;
    cache.clear();
    sizes.clear();
    retainedBytes = 0;
  }

  return {
    discover: run,
    invalidate,
    stats: () => ({ entries: cache.size, pending, capacity, retainedBytes, maxRetainedBytes }),
  };
}
