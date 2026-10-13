import { relative } from "node:path";
import { Context, Effect, Layer } from "effect";
import {
  LanguageSqlDialectState,
  type HostId,
  type LanguageCheckout,
  type LanguageSqlDialect,
} from "@polaris/protocol";
import { requestAuthority } from "../composition/authority.ts";
import { ProjectDiscovery } from "../discovery/index.ts";
import { checkoutPath } from "../trust/index.ts";
import { withDiscoveryBudget } from "../discovery/files.ts";
import { LanguageBroker, languageOperation } from "../runtime/service.ts";
import { SqlSelection } from "./selection.ts";
import { detectDialect } from "./detection.ts";

type Input = { checkout: LanguageCheckout; path: string };

function makeSqlCore(
  hostId: HostId,
  selection: SqlSelection["Service"],
  discovery: ProjectDiscovery["Service"],
  broker: LanguageBroker["Service"]
) {
  const get = Effect.fn("SqlCore.get")(function* (input: Input) {
    const auth = yield* requestAuthority(hostId);
    const canonical = yield* auth.checkout(input.checkout);

    const result = yield* languageOperation(async () => {
      const path = await checkoutPath(canonical, input.path);
      const record = await selection.read(canonical.checkout);
      const fileOverride = record.files[relative(canonical.root, path)] ?? null;

      const observed = await withDiscoveryBudget(canonical.root, () =>
        detectDialect(canonical.root, path)
      );

      const detected = observed.value;

      return LanguageSqlDialectState.make({
        checkout: canonical.checkout,
        path,
        revision: record.revision,
        fileOverride,
        workspaceOverride: record.workspace,
        dialect: fileOverride ?? record.workspace ?? detected.dialect,
        source:
          fileOverride !== null
            ? "file"
            : record.workspace !== null
              ? "workspace"
              : detected.source,
      });
    });

    yield* auth.checkout(input.checkout);
    yield* auth.check;

    return result;
  });

  const select = Effect.fn("SqlCore.select")(function* (
    input: Input & {
      scope: "file" | "workspace";
      dialect: LanguageSqlDialect | null;
      expectedRevision: number;
    }
  ) {
    const auth = yield* requestAuthority(hostId);
    const canonical = yield* auth.checkout(input.checkout);
    const path = yield* languageOperation(() => checkoutPath(canonical, input.path));
    yield* languageOperation(() =>
      selection.select(
        canonical.checkout,
        canonical.root,
        path,
        input.scope,
        input.dialect,
        input.expectedRevision,
        async () => {
          await Effect.runPromise(auth.checkout(input.checkout));
          await Effect.runPromise(auth.check);
        }
      )
    );
    yield* discovery.invalidate;
    yield* broker.restartMatching(
      null,
      null,
      input.checkout.workspaceId,
      "sqllens-language-server",
      canonical.checkout
    );

    return yield* get(input);
  });

  return { get, select };
}

export class SqlCore extends Context.Service<SqlCore, ReturnType<typeof makeSqlCore>>()(
  "polaris/languages/SqlCore"
) {
  static layer(hostId: HostId) {
    return Layer.effect(
      SqlCore,
      Effect.gen(function* () {
        return SqlCore.of(
          makeSqlCore(hostId, yield* SqlSelection, yield* ProjectDiscovery, yield* LanguageBroker)
        );
      })
    );
  }
}
