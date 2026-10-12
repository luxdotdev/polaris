import { Context, Effect, Layer } from "effect";
import type { HostId } from "@polaris/protocol";
import type { createProcessSettings } from "../runtime/processSettings.ts";
import { LanguageBroker, languageOperation } from "../runtime/service.ts";
import { requestAuthority } from "./authority.ts";

function makeProcessBudgetCore(
  hostId: HostId,
  settings: Awaited<ReturnType<typeof createProcessSettings>>,
  broker: LanguageBroker["Service"]
) {
  return {
    get: Effect.fn("LanguageProcessBudget.get")(function* () {
      const auth = yield* requestAuthority(hostId);
      yield* auth.check;

      return settings.snapshot();
    }),
    set: Effect.fn("LanguageProcessBudget.set")(function* (input: {
      expectedRevision: number;
      maxProcesses: number | null;
    }) {
      const auth = yield* requestAuthority(hostId);

      const selected = yield* languageOperation(() =>
        settings.set(
          input.expectedRevision,
          input.maxProcesses,
          () => Effect.runPromise(auth.check),
          (limit) => Effect.runPromise(broker.setProcessLimit(limit))
        )
      );

      yield* auth.check;

      return selected;
    }),
  };
}

export class LanguageProcessBudgetCore extends Context.Service<
  LanguageProcessBudgetCore,
  ReturnType<typeof makeProcessBudgetCore>
>()("polaris/languages/LanguageProcessBudgetCore") {
  static layer(hostId: HostId, settings: Awaited<ReturnType<typeof createProcessSettings>>) {
    return Layer.effect(
      LanguageProcessBudgetCore,
      Effect.map(LanguageBroker, (broker) => makeProcessBudgetCore(hostId, settings, broker))
    );
  }
}
