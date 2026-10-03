import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { resourceReceiptHandler } from "./bindings.ts";

/** Internal challenges run independently of the pending acceptance they verify. */
export const respondResourceReceiptRequest = async (
  api: LanguageApi,
  hostKey: string,
  event: Extract<P.LanguageContextEvent, { _tag: "ServerRequest" }>
): Promise<boolean> => {
  if (!Predicate.isTagged(event.payload, "ResourceReceipt")) return false;

  try {
    if (
      resourceReceiptHandler === null ||
      event.request.request.method !== "polaris/resourceReceipt" ||
      event.request.deadline <= Date.now()
    )
      throw new Error("Authenticated draft receipt verification is unavailable.");

    const receipt = await resourceReceiptHandler(
      hostKey,
      event.request.context,
      event.payload.challenge
    );

    if (event.request.deadline <= Date.now())
      throw new Error("The draft receipt challenge expired.");

    const result = Schema.encodeSync(P.LanguageResourceReceiptResponse)(receipt);

    await api.request("languages.server.respond", {
      hostKey,
      context: event.request.context,
      response: P.LanguageJsonRpcResponse.make({
        jsonrpc: "2.0",
        id: event.request.request.id,
        result,
      }),
    });
  } catch {
    await api
      .request("languages.server.respond", {
        hostKey,
        context: event.request.context,
        response: P.LanguageJsonRpcResponse.make({
          jsonrpc: "2.0",
          id: event.request.request.id,
          error: {
            code: -32001,
            message: "The authenticated durable draft receipt could not be verified.",
          },
        }),
      })
      .catch(() => undefined);
  }

  return true;
};
