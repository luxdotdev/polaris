import { dirname } from "node:path";
import { Context, Effect, Layer } from "effect";
import { LanguagePythonInterpreters, type HostId, type LanguageCheckout } from "@polaris/protocol";
import { requestAuthority } from "../composition/authority.ts";
import { ProjectDiscovery } from "../discovery/index.ts";
import { checkoutPath } from "../trust/index.ts";
import { isDirectory, withDiscoveryBudget } from "../discovery/files.ts";
import { LanguageBroker, languageOperation } from "../runtime/service.ts";
import { PythonEnvironment } from "./environment.ts";
import {
  detectPython,
  interpreterVersion,
  withVersion,
  type PythonProbeOptions,
} from "./detection.ts";

type Input = { checkout: LanguageCheckout; path: string };

function makePythonCore(
  hostId: HostId,
  environment: PythonEnvironment["Service"],
  discovery: ProjectDiscovery["Service"],
  broker: LanguageBroker["Service"],
  hostOptions?: PythonProbeOptions
) {
  const list = Effect.fn("PythonCore.list")(function* (input: Input) {
    const auth = yield* requestAuthority(hostId);
    const canonical = yield* auth.checkout(input.checkout);

    const result = yield* languageOperation(async () => {
      const path = await checkoutPath(canonical, input.path);
      const start = (await isDirectory(path)) ? path : dirname(path);
      const record = await environment.read(input.checkout.workspaceId);

      const observed = await withDiscoveryBudget(canonical.root, () =>
        detectPython(canonical.root, start, process.platform, hostOptions)
      );

      const candidates = observed.value;

      if (
        record.interpreter !== null &&
        !candidates.some((item) => item.path === record.interpreter)
      )
        candidates.unshift(
          withVersion(
            { path: record.interpreter, source: "override" },
            await interpreterVersion(record.interpreter)
          )
        );

      return LanguagePythonInterpreters.make({
        checkout: canonical.checkout,
        revision: record.revision,
        override: record.interpreter,
        selected: record.interpreter ?? candidates[0]?.path ?? null,
        interpreters: candidates.slice(0, 32),
      });
    });

    yield* auth.checkout(input.checkout);
    yield* auth.check;

    return result;
  });

  const select = Effect.fn("PythonCore.select")(function* (
    input: Input & { interpreter: string | null; expectedRevision: number }
  ) {
    const auth = yield* requestAuthority(hostId);
    const canonical = yield* auth.checkout(input.checkout);
    yield* languageOperation(() => checkoutPath(canonical, input.path));
    yield* languageOperation(async () =>
      environment.select(
        input.checkout.workspaceId,
        input.interpreter,
        input.expectedRevision,
        async () => {
          await Effect.runPromise(auth.checkout(input.checkout));
          await Effect.runPromise(auth.check);
        }
      )
    );
    yield* discovery.invalidate;
    yield* broker.restartMatching(null, null, input.checkout.workspaceId, "basedpyright");

    return yield* list(input);
  });

  return { list, select };
}

export class PythonCore extends Context.Service<PythonCore, ReturnType<typeof makePythonCore>>()(
  "polaris/languages/PythonCore"
) {
  static layer(hostId: HostId, hostOptions?: PythonProbeOptions) {
    return Layer.effect(
      PythonCore,
      Effect.gen(function* () {
        return PythonCore.of(
          makePythonCore(
            hostId,
            yield* PythonEnvironment,
            yield* ProjectDiscovery,
            yield* LanguageBroker,
            hostOptions
          )
        );
      })
    );
  }
}
