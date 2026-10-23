import { type ExtensionTokenRejected } from "@polaris/protocol";
import { Semaphore } from "effect";
import type { Rpc } from "effect/rpc";

interface Admission {
  role: "unbound" | "client" | "extension";
  rejection: ExtensionTokenRejected["reason"] | null;
  /** True on the gateway: the connection must present a token and a protocol range. */
  tokenRequired: boolean;
  readonly hello: Semaphore.Semaphore;
}

const admissions = new WeakMap<Rpc.ServerClient, Admission>();

export const admissionOf = (client: Rpc.ServerClient): Admission => {
  let admission = admissions.get(client);

  if (admission === undefined) {
    admission = {
      role: "unbound",
      rejection: null,
      tokenRequired: false,
      hello: Semaphore.makeUnsafe(1),
    };
    admissions.set(client, admission);
  }

  return admission;
};

/** Reserve the role before authentication can yield; even pre-hello Client RPCs bind it. */
export const reserveConnection = (
  client: Rpc.ServerClient,
  tokenPresented: boolean,
  tokenRequired = false
): void => {
  const admission = admissionOf(client);
  admission.tokenRequired ||= tokenRequired;

  if (admission.role === "unbound") {
    admission.role = tokenPresented || tokenRequired ? "extension" : "client";

    if (tokenRequired && !tokenPresented) admission.rejection = "missing";
  } else if (admission.role === "client" && tokenPresented) {
    admission.rejection = "connection-bound";
  }
};

/** Sealing is permanent, including for a hello still awaiting authentication. */
export const rejectConnection = (
  client: Rpc.ServerClient,
  reason: ExtensionTokenRejected["reason"] = "unknown"
): void => {
  const admission = admissionOf(client);
  admission.rejection ??= reason;
};

export const connectionRejected = (client: Rpc.ServerClient): boolean =>
  admissionOf(client).rejection !== null;
