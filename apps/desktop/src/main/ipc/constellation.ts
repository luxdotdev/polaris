/**
 * Constellation requests and the Constellation feed over IPC: each forwards the Daemon RPC of
 * the same name on the Lead's Host. A refusal's findings become one message, a line each.
 */
import type { LiveSession } from "@polaris/client";
import type { ConstellationRejected } from "@polaris/protocol";
import { Effect, Predicate, Stream } from "effect";
import type { IpcError } from "../../shared/api.ts";
import type { RequestInput, SubscriptionInput } from "../../shared/contract.ts";
import { HostDirectory, toIpcError } from "../hosts.ts";

type Failure = { readonly _tag: string; readonly message: string };

/** "<message>. <fix>" per finding, one per line; other failures keep their own code. */
export const constellationError = (error: Failure | ConstellationRejected): IpcError =>
  Predicate.isTagged(error, "ConstellationRejected") && "findings" in error
    ? {
        code: "ConstellationRejected",
        message: error.findings.map((f) => `${f.message.replace(/\.$/, "")}. ${f.fix}`).join("\n"),
      }
    : toIpcError(error);

const live = <A, E extends Failure>(
  hostKey: string,
  use: (s: LiveSession) => Effect.Effect<A, E>
) =>
  HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
    Effect.mapError(toIpcError),
    Effect.flatMap((c) => Effect.flatMap(c.session, use).pipe(Effect.mapError(constellationError)))
  );

export const constellationHandlers = {
  "constellation.plan": ({ hostKey, ...payload }: RequestInput<"constellation.plan">) =>
    live(hostKey, (s) => s.client["constellation.plan"](payload)),
  "constellation.dispatch": ({ hostKey, ...payload }: RequestInput<"constellation.dispatch">) =>
    live(hostKey, (s) => s.client["constellation.dispatch"](payload)),
  "constellation.review": ({ hostKey, ...payload }: RequestInput<"constellation.review">) =>
    live(hostKey, (s) => s.client["constellation.review"](payload)),
  "constellation.answer": ({ hostKey, ...payload }: RequestInput<"constellation.answer">) =>
    live(hostKey, (s) => s.client["constellation.answer"](payload)),
  "constellation.message": ({ hostKey, ...payload }: RequestInput<"constellation.message">) =>
    live(hostKey, (s) => s.client["constellation.message"](payload)),
  "constellation.set_state": ({ hostKey, ...payload }: RequestInput<"constellation.set_state">) =>
    live(hostKey, (s) => s.client["constellation.set_state"](payload)),
  "constellation.status": ({ hostKey, ...payload }: RequestInput<"constellation.status">) =>
    live(hostKey, (s) => s.client["constellation.status"](payload)),
  "constellation.defaults.get": ({ hostKey }: RequestInput<"constellation.defaults.get">) =>
    live(hostKey, (s) => s.client["constellation.defaults.get"]({})),
  "constellation.defaults.set": ({
    hostKey,
    ...payload
  }: RequestInput<"constellation.defaults.set">) =>
    live(hostKey, (s) => s.client["constellation.defaults.set"](payload)),
};

/** Settings → Hosts: resources and the worker cap; every call answers with the whole snapshot. */
export const resourceHandlers = {
  "host.resources.get": ({ hostKey }: RequestInput<"host.resources.get">) =>
    live(hostKey, (s) => s.client["host.resources.get"]({})),
  "host.resources.declare": ({ hostKey, ...payload }: RequestInput<"host.resources.declare">) =>
    live(hostKey, (s) => s.client["host.resources.declare"](payload)),
  "host.resources.remove": ({ hostKey, ...payload }: RequestInput<"host.resources.remove">) =>
    live(hostKey, (s) => s.client["host.resources.remove"](payload)),
  "host.resources.release": ({ hostKey, ...payload }: RequestInput<"host.resources.release">) =>
    live(hostKey, (s) => s.client["host.resources.release"](payload)),
  "host.workers.setCap": ({ hostKey, ...payload }: RequestInput<"host.workers.setCap">) =>
    live(hostKey, (s) => s.client["host.workers.setCap"](payload)),
};

/** The Constellation's stream; it ends when the connection drops (resubscribe with `afterSequence`). */
export const constellationFeed = ({ hostKey, ...payload }: SubscriptionInput<"constellation">) =>
  Stream.unwrap(
    HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
      Effect.flatMap((c) => c.session),
      Effect.map((s) => s.client["constellation.subscribe"](payload))
    )
  ).pipe(Stream.mapError(constellationError));
