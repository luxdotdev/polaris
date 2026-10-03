import { Effect, Layer } from "effect";
import { ServerRpcs } from "../../transport/rpcs.ts";
import { LanguageResourceEdits } from "./resourceEdits.ts";

/** Lead mounts this with the existing Host singleton services and authenticated private receipt authority. */
export const languageResourceEditHandlers = Layer.mergeAll(
  ServerRpcs.toLayerHandler("languages.tree.edit.decide", (input) =>
    Effect.flatMap(LanguageResourceEdits, (resources) => resources.treeDecide(input))
  ),
  ServerRpcs.toLayerHandler("languages.tree.operation.get", (input) =>
    Effect.flatMap(LanguageResourceEdits, (resources) => resources.treeGet(input))
  ),
  ServerRpcs.toLayerHandler("languages.tree.operation.recover", (input) =>
    Effect.flatMap(LanguageResourceEdits, (resources) => resources.treeRecover(input))
  )
);
