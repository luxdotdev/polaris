import { LanguageError } from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { CurrentLanguageConnection } from "../../transport/currentLanguageConnection.ts";
import { ServerRpcs } from "../../transport/rpcs.ts";
import { registeredCheckout } from "../registeredCheckout.ts";
import { HostPreviewMedia, PreviewMediaAuthority } from "./index.ts";

const unavailable = () =>
  new LanguageError({
    reason: "not-owner",
    message: "Language connection unavailable",
    retryable: false,
  });

export const PreviewMediaRpc = ServerRpcs.toLayerHandler("languages.preview.media", (input) =>
  Effect.gen(function* () {
    const connection = yield* CurrentLanguageConnection;
    const principal = connection.current();
    const store = yield* EventStore;
    const media = yield* HostPreviewMedia;

    if (principal === null) return yield* Effect.fail(unavailable());

    const authority = PreviewMediaAuthority.of({
      authorize: async (checkout, signal) => {
        if (signal.aborted || connection.current() !== principal) throw unavailable();
        const model = await Effect.runPromise(store.model, { signal });

        if (signal.aborted || connection.current() !== principal) throw unavailable();

        return registeredCheckout(model, checkout);
      },
    });

    return yield* media.read(input).pipe(Effect.provideService(PreviewMediaAuthority, authority));
  })
);
