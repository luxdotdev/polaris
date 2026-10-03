import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { fingerprint } from "../../files/edits/journal.ts";

interface Evidence {
  readonly clientId: string;
  readonly requestHash: string;
  readonly resultHash: string;
  readonly expiresAt: number;
}

export interface EditFeatureIntent {
  readonly request: P.LanguageFeatureRequest;
  readonly result: P.LanguageFeatureResult;
  readonly origin: "rename" | "code-action";
  readonly edit: P.LanguageWorkspaceEdit;
}

interface VerificationPorts<A, R> {
  readonly owned: (clientId: string, context: P.LanguageContextIdentity) => A;
  readonly fence: (entry: A, fence: P.LanguageRequestFence) => void;
  readonly trusted: (entry: A) => Promise<R>;
}

export const createFeatureVerifier =
  <A, R>(evidence: FeatureEvidence, ports: VerificationPorts<A, R>) =>
  async (clientId: string, intent: EditFeatureIntent) => {
    const current = () => {
      const entry = ports.owned(clientId, intent.request.fence.context);
      ports.fence(entry, intent.request.fence);
      evidence.verify(clientId, intent.request, intent.result, intent.origin, intent.edit);

      return entry;
    };

    await ports.trusted(current());
    current();
  };

const invalid = () =>
  new P.LanguageError({
    reason: "stale-document",
    message: "Edit intent is not a current Host result",
    retryable: false,
  });

const keyOf = (clientId: string, request: P.LanguageFeatureRequest) =>
  JSON.stringify([clientId, request.fence.context, request.requestId]);

const editsOf = (request: P.LanguageFeatureRequest, result: P.LanguageFeatureResult) => {
  if (request.method === "textDocument/rename") {
    const edit = Schema.decodeUnknownSync(P.LanguageWorkspaceEdit)(result.result);

    if (fingerprint(edit) !== fingerprint(result.result)) throw invalid();

    return [edit];
  }

  const action = Schema.Struct({ edit: Schema.optionalKey(P.LanguageWorkspaceEdit) });

  if (request.method === "codeAction/resolve") {
    const value = Schema.decodeUnknownSync(action)(result.result);

    return value.edit === undefined ? [] : [value.edit];
  }

  if (request.method === "textDocument/codeAction")
    return Schema.decodeUnknownSync(Schema.Array(action))(result.result).flatMap((value) =>
      value.edit === undefined ? [] : [value.edit]
    );

  throw invalid();
};

/** Retain hashes of actual broker deliveries; renderer echoes never create evidence. */
export class FeatureEvidence {
  private readonly records = new Map<string, Evidence>();

  constructor(readonly now: () => number = Date.now) {}

  private prune() {
    for (const [key, evidence] of this.records)
      if (evidence.expiresAt <= this.now()) this.records.delete(key);
  }

  record(clientId: string, request: P.LanguageFeatureRequest, result: P.LanguageFeatureResult) {
    if (
      request.method !== "textDocument/rename" &&
      request.method !== "textDocument/codeAction" &&
      request.method !== "codeAction/resolve"
    )
      return;

    this.prune();

    if (
      request.fence.context.clientId !== clientId ||
      request.requestId !== result.requestId ||
      fingerprint(request.fence) !== fingerprint(result.fence)
    )
      throw invalid();

    const key = keyOf(clientId, request);

    if (!this.records.has(key) && this.records.size >= 64) {
      const oldest = this.records.keys().next().value;

      if (oldest !== undefined) this.records.delete(oldest);
    }

    this.records.set(key, {
      clientId,
      requestHash: fingerprint(request),
      resultHash: fingerprint(result),
      expiresAt: this.now() + 30000,
    });
  }

  verify(
    clientId: string,
    request: P.LanguageFeatureRequest,
    result: P.LanguageFeatureResult,
    origin: "rename" | "code-action",
    edit: P.LanguageWorkspaceEdit
  ) {
    this.prune();
    const evidence = this.records.get(keyOf(clientId, request));

    if (
      evidence === undefined ||
      request.fence.context.clientId !== clientId ||
      evidence.requestHash !== fingerprint(request) ||
      evidence.resultHash !== fingerprint(result) ||
      (origin === "rename") !== (request.method === "textDocument/rename")
    )
      throw invalid();

    const requested = Schema.decodeUnknownSync(P.LanguageWorkspaceEdit)(edit);

    if (
      !editsOf(request, result).some((offered) => fingerprint(offered) === fingerprint(requested))
    )
      throw invalid();
  }

  forget(clientId: string) {
    for (const [key, evidence] of this.records)
      if (evidence.clientId === clientId) this.records.delete(key);
  }
}
