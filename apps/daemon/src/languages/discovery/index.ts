import { relative } from "node:path";
import { detectDialect } from "../sql/detection.ts";
import type { createSqlSelection } from "../sql/selection.ts";
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
import { ancestors, isDirectory, nearest, readText, withDiscoveryBudget } from "./files.ts";
import { configPlugins, pluginFacts, typescriptSdk } from "./typescript.ts";
import { projectRoot, prismaFacts, workspaceFacts, svelteConfiguration } from "./roots.ts";
import { pythonInterpreter } from "./python.ts";
import { detectPython, type PythonProbeOptions } from "../python/detection.ts";
import { interpreterEntry, type createPythonEnvironment } from "../python/environment.ts";
import { configurationFingerprint } from "./configuration.ts";
import { workspaceTools } from "../php/projectTools.ts";
import { rustLuaFacts } from "../rust/facts.ts";

export { effectiveSettings, configurationFingerprint } from "./configuration.ts";

export { ProjectDiscovery } from "./service.ts";

export interface DiscoveryInput {
  checkout: LanguageCheckout;
  path: string;
  providerId: string;
  settings: typeof LanguageEffectiveSettings.Type;
  refresh?: boolean;
  useProjectTypeScript?: boolean;
  workspaceTrusted?: boolean;
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
    "svelte-language-server": "svelte",
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

    return { sdk, tsserver, nativeServer: null, sdkVersion: null };
  }

  const detected = provider === "typescript" ? await typescriptSdk(root, project) : null;

  return {
    sdk: detected?.sdk ?? null,
    tsserver: detected?.server ?? null,
    sdkVersion: detected?.version ?? null,
    nativeServer: detected?.nativeServer ?? null,
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
    if (provider !== "python") {
      const path = await overridePath(root, override);

      return { interpreter: path, interpreterTarget: path, pythonConfiguration: null };
    }

    const entry = await interpreterEntry(isAbsolute(override) ? override : resolve(root, override));

    return { interpreter: entry.path, interpreterTarget: entry.target, pythonConfiguration: null };
  }

  const detected = provider === "python" ? await pythonInterpreter(root, start, platform) : null;

  return {
    interpreter: detected?.path ?? null,
    interpreterTarget: detected?.target ?? null,
    pythonConfiguration: detected?.configuration ?? null,
  };
}

async function supportedShell(provider: string, path: string) {
  if (provider === "bash" && !(await isDirectory(path))) {
    const name = path.split("/").at(-1) ?? "";
    const firstLine = (await readText(path)).split("\n", 1)[0] ?? "";

    if (
      /\.(zsh|fish)$|^\.(zshrc|zprofile|zlogin|zlogout)$/.test(name) ||
      /^#!.*\b(zsh|fish)\b/.test(firstLine)
    )
      throw new LanguageError({
        reason: "unsupported-capability",
        message: "Bash tooling supports Bash and POSIX shells; zsh and fish are highlighted only",
        retryable: false,
      });
  }
}

/** Which bundled servers run: none once the user names a custom server or executable. */
const managedFacts = (plain: boolean, provider: string) => ({
  managedSqlShell: plain && ["sql", "bash"].includes(provider),
  managedWeb: plain,
  managedPython: plain && provider === "python",
  managedPhp: plain && provider === "php",
});

async function discover(
  context: Awaited<ReturnType<typeof canonicalCheckout>>,
  path: string,
  input: DiscoveryInput,
  platform: NodeJS.Platform,
  bundled: boolean,
  pythonOptions: { override: string | null | undefined; host: PythonProbeOptions | undefined }
) {
  const provider = family(input.providerId);
  let settings = Schema.decodeUnknownSync(LanguageEffectiveSettings)(input.settings);

  if (provider === "python" && pythonOptions.override != null)
    settings = {
      ...settings,
      settings: { ...settings.settings, interpreter: pythonOptions.override },
    };
  const custom = settings.settings.customServers?.find(({ id }) => id === input.providerId);

  const executable = settings.settings.executableOverrides?.[input.providerId] ?? custom?.launch;
  const plain = bundled && custom === undefined && executable === undefined;

  const bundledTypeScript =
    plain && provider === "typescript" && input.useProjectTypeScript !== true;

  await supportedShell(provider, path);

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

  const python = await interpreterFacts(
    context.root,
    start,
    provider,
    platform,
    settings.settings.interpreter
  );

  await detectedInterpreter(python, context.root, start, provider, platform, pythonOptions.host);

  return {
    checkout: context.checkout,
    projectRoot: root,
    providerId: input.providerId,
    bundledTypeScript,
    workspaceTrusted: input.workspaceTrusted === true,
    ...managedFacts(plain, provider),
    svelteConfiguration: await svelteConfiguration(context.root, start, provider),
    workspaceTools: await workspaceTools(context.root, root, provider),
    ...(await rustLuaFacts(context.root, root, provider, input.workspaceTrusted === true, {
      managed: plain,
    })),
    configuration: provider === "typescript" ? configuration : null,
    ...(await sdkFacts(context.root, root, provider, settings.settings.sdk)),
    ...python,
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
  sqlDialect?: import("@polaris/protocol").LanguageSqlDialect | null;
  configurationFingerprint: string;
  configurationInputs: Record<string, string>;
};

/** Demand-only LRU. No timers, watchers, executable imports, shell lookup or process invocation. */
export function createProjectDiscovery(options: {
  registry: CheckoutRegistry;
  capacity?: number;
  maxPending?: number;
  platform?: NodeJS.Platform;
  bundledTypeScript?: boolean;
  pythonEnvironment?: ReturnType<typeof createPythonEnvironment>;
  pythonHost?: PythonProbeOptions;
  sqlSelection?: ReturnType<typeof createSqlSelection>;
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
        input.useProjectTypeScript ?? false,
        input.workspaceTrusted ?? false,
      ]);

      const cached = cache.get(key);

      if (cached !== undefined && !input.refresh) {
        cache.delete(key);
        cache.set(key, cached);

        return structuredClone(cached);
      }

      remove(key);

      const pythonSelection =
        family(input.providerId) === "python"
          ? await options.pythonEnvironment?.read(context.checkout.workspaceId)
          : undefined;

      const observed = await withDiscoveryBudget(context.root, () =>
        discover(
          context,
          path,
          input,
          options.platform ?? process.platform,
          options.bundledTypeScript === true,
          { override: pythonSelection?.interpreter, host: options.pythonHost }
        )
      );

      const sqlRecord =
        family(input.providerId) === "sql"
          ? await options.sqlSelection?.read(context.checkout)
          : undefined;

      const sql =
        family(input.providerId) === "sql"
          ? await withDiscoveryBudget(context.root, async () => {
              const record = sqlRecord;
              const detected = await detectDialect(context.root, path);

              return (
                record?.files[relative(context.root, path)] ?? record?.workspace ?? detected.dialect
              );
            })
          : null;

      const facts = {
        ...observed.value,
        sqlDialect: sql?.value ?? null,
        configurationInputs: { ...observed.configurationInputs, ...sql?.configurationInputs },
      };

      const result = { ...facts, configurationFingerprint: providerFingerprint(facts) };
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

async function detectedInterpreter(
  python: Awaited<ReturnType<typeof interpreterFacts>>,
  root: string,
  start: string,
  provider: string,
  platform: NodeJS.Platform,
  host?: PythonProbeOptions
) {
  if (provider !== "python" || python.interpreter !== null) return;
  const candidate = (await detectPython(root, start, platform, host))[0];

  if (candidate === undefined) return;
  const entry = await interpreterEntry(candidate.path);
  python.interpreter = entry.path;
  python.interpreterTarget = entry.target;
}

function providerFingerprint(
  facts: Awaited<ReturnType<typeof discover>> & { configurationInputs: Record<string, string> }
) {
  if (facts.providerId !== "ruff") return configurationFingerprint(facts);
  const identity = structuredClone(facts);
  identity.interpreter = facts.interpreter === null ? null : "present";
  identity.interpreterTarget = null;
  identity.pythonConfiguration = null;
  identity.effectiveSettings = {
    ...identity.effectiveSettings,
    settings: { ...identity.effectiveSettings.settings, interpreter: null },
  };

  return configurationFingerprint(identity);
}
