import {
  LanguageConfigurationItem,
  LanguageContextEvent,
  LanguageDiagnostic,
  LanguageDiagnostics,
  LanguageEditProposal,
  LanguageJsonRpcRequest,
  LanguageProgress,
  LanguageRegistration,
  LanguageRpcId,
  LanguageServerResponse,
  LanguageRequestFence,
  LanguageServerRequestPayload,
  LanguageFeatureMethod,
  LanguageWorkspaceEdit,
  LanguagePreparedEditProposal,
  decodeLanguageResourceProposal,
  LanguageTreeEditProposal,
  LanguageResourceReceiptChallenge,
  LanguageResourceReceiptResponse,
} from "@polaris/protocol";
import type {
  LanguageContextIdentity,
  LanguageJsonRpcEnvelope,
  LanguageProviderCapabilities,
  LanguageJson,
  LanguageJsonObject,
} from "@polaris/protocol";
import { Schema } from "effect";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { fingerprint } from "../../files/edits/journal.ts";
import type { OrderedConnection } from "../transport/index.ts";
import { bounded } from "../transport/deadline.ts";
import { failure } from "../transport/framing.ts";
import type { Documents } from "./documents.ts";
import { registeredCapabilities } from "./capabilities.ts";

export interface ServerHooks {
  context: LanguageContextIdentity;
  documents: Documents;
  connection: OrderedConnection;
  settings: typeof LanguageJsonObject.Type;
  emit: (event: LanguageContextEvent) => void;
  current: () => boolean;
  authorize: () => Promise<void>;
  /** Independently negotiated Client support, never inferred from a proposal's fields. */
  treeEdits?: () => boolean;
  prepareEdit:
    | undefined
    | ((
        edit: LanguageWorkspaceEdit,
        proposal: LanguageEditProposal
      ) => Promise<LanguageEditProposal | LanguageTreeEditProposal>);
  capabilities: (capabilities: LanguageProviderCapabilities) => void;
}

const Configuration = Schema.Struct({
  items: Schema.Array(LanguageConfigurationItem).check(Schema.isMaxLength(256)),
});

const Register = Schema.Struct({
  registrations: Schema.Array(LanguageRegistration).check(Schema.isMaxLength(256)),
});

const Unregister = Schema.Struct({
  unregisterations: Schema.Array(Schema.Struct({ id: Schema.String, method: Schema.String })).check(
    Schema.isMaxLength(256)
  ),
});

const Token = Schema.Struct({ token: LanguageRpcId });

const ApplyEdit = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  edit: LanguageWorkspaceEdit,
});

const Diagnostic = Schema.Struct({
  uri: Schema.String,
  version: Schema.optionalKey(Schema.Int),
  diagnostics: Schema.Array(
    Schema.Struct({
      range: LanguageDiagnostic.fields.range,
      severity: Schema.optionalKey(LanguageDiagnostic.fields.severity),
      code: Schema.optionalKey(LanguageDiagnostic.fields.code),
      source: Schema.optionalKey(Schema.String),
      message: LanguageDiagnostic.fields.message,
      tags: Schema.optionalKey(LanguageDiagnostic.fields.tags),
      data: Schema.optionalKey(Schema.Json),
      codeDescription: LanguageDiagnostic.fields.codeDescription,
      relatedInformation: LanguageDiagnostic.fields.relatedInformation,
    })
  ).check(Schema.isMaxLength(10000)),
});

const Progress = Schema.Struct({ token: LanguageRpcId, value: Schema.JsonObject });

const ShowMessage = Schema.Struct({
  type: Schema.Literals([1, 2, 3, 4]),
  message: Schema.String,
  actions: Schema.optionalKey(
    Schema.Array(Schema.Struct({ title: Schema.String })).check(Schema.isMaxLength(32))
  ),
});

interface PendingServerRequest {
  request: typeof LanguageJsonRpcRequest.Type;
  timer: ReturnType<typeof setTimeout>;
  fence?: LanguageRequestFence;
  internal?: {
    challenge: LanguageResourceReceiptChallenge;
    resolve: (response: LanguageResourceReceiptResponse) => void;
    reject: (cause: Error) => void;
    cleanup: () => void;
  };
}

export class ServerBridge {
  private registrations = new Map<string, typeof LanguageRegistration.Type>();
  private progress = new Set<string>();
  private pending = new Map<string, PendingServerRequest>();
  private base: LanguageProviderCapabilities | undefined;
  constructor(private readonly hooks: ServerHooks) {}
  setBase(base: LanguageProviderCapabilities) {
    this.base = base;
    this.publishCapabilities();
  }

  private receiving = 0;
  private logs = 0;
  receive(message: LanguageJsonRpcEnvelope) {
    if (!this.hooks.current()) return;
    const request = Schema.is(LanguageJsonRpcRequest)(message) ? message : undefined;

    if (this.receiving >= 64) {
      if (request !== undefined) void this.error(request.id, -32800, "Server request queue full");

      return;
    }

    this.receiving++;
    void this.dispatch(message)
      .catch(() => {
        if (request !== undefined && this.hooks.current())
          void this.error(request.id, -32602, "Invalid server request");
      })
      .finally(() => this.receiving--);
  }
  private async dispatch(message: LanguageJsonRpcEnvelope) {
    await this.hooks.authorize();

    if (!this.hooks.current()) return;

    if (Schema.is(LanguageJsonRpcRequest)(message)) await this.request(message);
    else if ("method" in message) this.notification(message.method, message.params);
  }

  private send(id: typeof LanguageRpcId.Type, result: typeof LanguageJson.Type) {
    return this.hooks.connection.send({ jsonrpc: "2.0", id, result }).catch(() => {});
  }
  private error(id: typeof LanguageRpcId.Type, code: number, message: string) {
    return this.hooks.connection
      .send({ jsonrpc: "2.0", id, error: { code, message } })
      .catch(() => {});
  }
  private publishCapabilities() {
    if (this.base === undefined) return;
    const registrations = [...this.registrations.values()];
    const capabilities = registeredCapabilities(this.base, registrations);
    this.hooks.capabilities(capabilities);
    this.hooks.emit(
      LanguageContextEvent.cases.CapabilitiesChanged.make({
        context: this.hooks.context,
        capabilities,
        registrations,
      })
    );
  }

  private configuration(
    params: (typeof import("@polaris/protocol").LanguageJsonRpcNotification.Type)["params"]
  ): (typeof LanguageJson.Type)[] {
    return Schema.decodeUnknownSync(Configuration)(params).items.map(({ section, scopeUri }) => {
      if (scopeUri !== undefined) this.hooks.documents.validateUri(scopeUri);
      let value: typeof LanguageJson.Type = this.hooks.settings;

      for (const part of section?.split(".") ?? []) {
        if (!Schema.is(Schema.JsonObject)(value)) return null;
        value = value[part] ?? null;
      }

      return value;
    });
  }

  private register(params: (typeof LanguageJsonRpcRequest.Type)["params"]) {
    const input = Schema.decodeUnknownSync(Register)(params);

    if (this.registrations.size + input.registrations.length > 256)
      throw failure("queue-full", "Registration limit");

    for (const registration of input.registrations) {
      if (
        !Schema.is(LanguageFeatureMethod)(registration.method) &&
        !["textDocument/formatting", "textDocument/rangeFormatting"].includes(registration.method)
      )
        throw failure("unsupported-capability", "Dynamic method is not implemented");
    }

    for (const registration of input.registrations)
      this.registrations.set(registration.id, registration);
    this.publishCapabilities();
  }

  private async request(request: typeof LanguageJsonRpcRequest.Type) {
    const { id, method, params } = request;

    switch (method) {
      case "workspace/configuration":
        await this.send(id, this.configuration(params));

        return;
      case "workspace/workspaceFolders":
        await this.send(id, [
          { uri: pathToFileURL(this.hooks.context.projectRoot).href, name: "project" },
        ]);

        return;
      case "client/registerCapability": {
        this.register(params);
        await this.send(id, null);

        return;
      }

      case "client/unregisterCapability": {
        const input = Schema.decodeUnknownSync(Unregister)(params);

        for (const registration of input.unregisterations)
          this.registrations.delete(registration.id);
        this.publishCapabilities();
        await this.send(id, null);

        return;
      }

      case "window/workDoneProgress/create": {
        const { token } = Schema.decodeUnknownSync(Token)(params);

        if (this.progress.size >= 64) throw failure("queue-full", "Progress token limit");
        this.progress.add(JSON.stringify(token));
        await this.send(id, null);

        return;
      }

      case "workspace/applyEdit":
        await this.applyEdit(request);

        return;

      case "window/showMessageRequest": {
        const input = Schema.decodeUnknownSync(ShowMessage)(params);
        this.forward(
          request,
          LanguageServerRequestPayload.cases.ShowMessage.make({
            ...input,
            actions: input.actions ?? [],
          })
        );

        return;
      }

      case "workspace/diagnostic/refresh":
      case "workspace/semanticTokens/refresh":
      case "workspace/inlayHint/refresh":
        await this.send(id, null);

        return;
      default:
        await this.error(id, -32601, "Unsupported server method");
    }
  }

  private async applyEdit(request: typeof LanguageJsonRpcRequest.Type) {
    const { id, params } = request;

    if (this.hooks.prepareEdit === undefined) {
      await this.send(id, { applied: false, failureReason: "Edit preview unavailable" });

      return;
    }

    const input = Schema.decodeUnknownSync(ApplyEdit)(params);

    if (
      input.edit.documentChanges?.some((change) => "kind" in change) &&
      this.hooks.treeEdits?.() !== true
    ) {
      await this.send(id, {
        applied: false,
        failureReason: "Resource edit preview unavailable",
      });

      return;
    }

    const proposal = LanguageEditProposal.make({
      proposalId: randomUUID(),
      fence: {
        context: this.hooks.context,
        requiredSequence: this.hooks.documents.sequence,
        documents: this.hooks.documents.ack().documents,
      },
      origin: "server-apply-edit",
      label: input.label ?? "Language edits",
      edit: input.edit,
      snapshots: [],
      expiresAt: Date.now() + 10000,
    });

    const prepared = decodeLanguageResourceProposal(
      Schema.encodeSync(LanguagePreparedEditProposal)(
        await bounded(this.hooks.prepareEdit(input.edit, proposal), 10000)
      )
    );

    if (!this.hooks.current()) return;
    this.hooks.documents.fence(proposal.fence);
    this.hooks.documents.fence(prepared.fence);

    if (
      prepared.proposalId !== proposal.proposalId ||
      prepared.origin !== proposal.origin ||
      prepared.expiresAt !== proposal.expiresAt ||
      prepared.label !== proposal.label ||
      fingerprint(prepared.edit) !== fingerprint(proposal.edit) ||
      fingerprint(prepared.fence) !== fingerprint(proposal.fence)
    )
      throw failure("invalid-input", "Prepared edit identity changed");

    if (Schema.is(LanguageTreeEditProposal)(prepared)) {
      if (this.hooks.treeEdits?.() !== true) {
        await this.send(id, {
          applied: false,
          failureReason: "Resource edit preview unavailable",
        });

        return;
      }

      this.forward(
        request,
        LanguageServerRequestPayload.cases.TreeApplyEdit.make({ proposal: prepared })
      );

      return;
    }

    if (prepared.edit.documentChanges?.some((change) => "kind" in change)) {
      await this.send(id, {
        applied: false,
        failureReason: "Resource edit snapshots unavailable",
      });

      return;
    }

    this.forward(
      request,
      LanguageServerRequestPayload.cases.ApplyEdit.make({ proposal: prepared })
    );

    return;
  }

  private forward(
    request: typeof LanguageJsonRpcRequest.Type,
    payload: typeof import("@polaris/protocol").LanguageServerRequestPayload.Type
  ) {
    const key = JSON.stringify(request.id);

    if (this.pending.size >= 32 || this.pending.has(key))
      throw failure("queue-full", "Server request limit");

    const timer = setTimeout(() => {
      this.pending.delete(key);
      void this.error(request.id, -32800, "Client response deadline exceeded");
    }, 10000);

    const pending: PendingServerRequest = { request, timer };

    if (
      Schema.is(LanguageServerRequestPayload.cases.ApplyEdit)(payload) ||
      Schema.is(LanguageServerRequestPayload.cases.TreeApplyEdit)(payload)
    )
      pending.fence = payload.proposal.fence;
    this.pending.set(key, pending);
    this.hooks.emit(
      LanguageContextEvent.cases.ServerRequest.make({
        request: { context: this.hooks.context, request, deadline: Date.now() + 10000 },
        payload,
      })
    );
  }

  async challengeReceipt(
    challenge: LanguageResourceReceiptChallenge,
    signal: AbortSignal,
    deadlineMs = 5000
  ) {
    const payload = LanguageServerRequestPayload.cases.ResourceReceipt.make({ challenge });
    await this.hooks.authorize();

    if (!this.hooks.current() || signal.aborted)
      throw failure("cancelled", "Receipt challenge cancelled");

    if (this.hooks.treeEdits?.() !== true)
      throw failure("unsupported-capability", "Receipt challenge unavailable");

    if (this.pending.size >= 32) throw failure("queue-full", "Server request limit");
    const id = `resource-receipt-${randomUUID()}`;
    const key = JSON.stringify(id);

    const request = LanguageJsonRpcRequest.make({
      jsonrpc: "2.0",
      id,
      method: "polaris/resourceReceipt",
    });

    return new Promise<LanguageResourceReceiptResponse>((resolve, reject) => {
      const cancel = (cause: Error) => {
        const pending = this.pending.get(key);

        if (pending === undefined) return;
        this.pending.delete(key);
        clearTimeout(pending.timer);
        pending.internal?.cleanup();
        reject(cause);
      };

      const aborted = () => cancel(failure("cancelled", "Receipt challenge cancelled"));

      const timer = setTimeout(
        () => cancel(failure("timeout", "Receipt challenge timed out")),
        deadlineMs
      );

      const pending: PendingServerRequest = {
        request,
        timer,
        internal: {
          challenge,
          resolve,
          reject,
          cleanup: () => signal.removeEventListener("abort", aborted),
        },
      };

      this.pending.set(key, pending);
      signal.addEventListener("abort", aborted, { once: true });

      if (signal.aborted) {
        aborted();

        return;
      }

      try {
        this.hooks.emit(
          LanguageContextEvent.cases.ServerRequest.make({
            request: { context: this.hooks.context, request, deadline: Date.now() + deadlineMs },
            payload,
          })
        );
      } catch {
        cancel(failure("invalid-input", "Receipt challenge delivery failed"));
      }
    });
  }

  respond(input: typeof LanguageServerResponse.Type) {
    const key = JSON.stringify(input.response.id);
    const pending = this.pending.get(key);

    if (pending === undefined)
      throw failure("stale-generation", "Server request no longer pending");

    if (pending.internal !== undefined) {
      this.pending.delete(key);
      clearTimeout(pending.timer);
      pending.internal.cleanup();

      try {
        if (
          !this.hooks.current() ||
          fingerprint(input.context) !== fingerprint(this.hooks.context) ||
          !("result" in input.response)
        )
          throw failure("not-owner", "Receipt response is unavailable");

        const response = Schema.decodeUnknownSync(LanguageResourceReceiptResponse)(
          input.response.result
        );

        if (
          response.nonce !== pending.internal.challenge.nonce ||
          response.operationId !== pending.internal.challenge.operationId
        )
          throw failure("not-owner", "Receipt challenge identity changed");
        pending.internal.resolve(response);
      } catch {
        const cause = failure("not-owner", "Receipt challenge rejected");
        pending.internal.reject(cause);
        throw cause;
      }

      return Promise.resolve();
    }

    if (pending.fence !== undefined) this.hooks.documents.fence(pending.fence);
    this.pending.delete(key);
    clearTimeout(pending.timer);

    return this.hooks.connection.send(input.response);
  }

  pull(
    uri: string,
    version: number,
    result: typeof LanguageJson.Type,
    previousResultId: string | null
  ) {
    const report = Schema.decodeUnknownSync(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literal("full"),
          resultId: Schema.optionalKey(Schema.String),
          items: Diagnostic.fields.diagnostics,
        }),
        Schema.Struct({ kind: Schema.Literal("unchanged"), resultId: Schema.String }),
      ])
    )(result);

    this.hooks.documents.validateUri(uri);

    if (this.hooks.documents.open.get(uri)?.version !== version)
      throw failure("stale-document", "Diagnostic document changed");

    const items =
      report.kind === "full"
        ? report.items.slice(0, 2000).map((item) =>
            LanguageDiagnostic.make({
              ...item,
              severity: item.severity ?? null,
              code: item.code ?? null,
              source: item.source ?? this.hooks.context.providerId,
              tags: item.tags ?? [],
            })
          )
        : [];

    const diagnostics = LanguageDiagnostics.make({
      context: this.hooks.context,
      uri,
      providerId: this.hooks.context.providerId,
      generation: this.hooks.context.generation,
      version,
      freshness: "versioned",
      kind: report.kind,
      resultId: report.resultId ?? null,
      previousResultId,
      items,
      truncated: report.kind === "full" && report.items.length > items.length,
    });

    this.hooks.emit(LanguageContextEvent.cases.Diagnostics.make({ diagnostics }));
  }

  private notification(
    method: string,
    params: (typeof import("@polaris/protocol").LanguageJsonRpcNotification.Type)["params"]
  ) {
    if (method === "textDocument/publishDiagnostics") {
      const input = Schema.decodeUnknownSync(Diagnostic)(params);
      this.hooks.documents.validateUri(input.uri);
      const document = this.hooks.documents.open.get(input.uri);

      if (
        document === undefined ||
        (input.version !== undefined && input.version !== document.version)
      )
        return;

      const items = input.diagnostics.slice(0, 2000).map((item) =>
        LanguageDiagnostic.make({
          ...item,
          severity: item.severity ?? null,
          code: item.code ?? null,
          source: item.source ?? this.hooks.context.providerId,
          tags: item.tags ?? [],
        })
      );

      const diagnostics = LanguageDiagnostics.make({
        context: this.hooks.context,
        uri: input.uri,
        providerId: this.hooks.context.providerId,
        generation: this.hooks.context.generation,
        version: input.version ?? null,
        freshness: input.version === undefined ? "unversioned" : "versioned",
        kind: "full",
        resultId: null,
        previousResultId: null,
        items,
        truncated: input.diagnostics.length > items.length,
      });

      this.hooks.emit(LanguageContextEvent.cases.Diagnostics.make({ diagnostics }));
    }

    if (method === "window/logMessage" && this.logs < 64) {
      const log = Schema.decodeUnknownSync(ShowMessage)(params);
      this.logs++;
      this.hooks.emit(
        LanguageContextEvent.cases.Log.make({
          context: this.hooks.context,
          level: (["error", "warning", "info", "debug"] as const)[log.type - 1]!,
          message: "Language server log received; private output withheld",
        })
      );
    }

    if (method === "$/progress") {
      const input = Schema.decodeUnknownSync(Progress)(params);
      const key = JSON.stringify(input.token);

      if (!this.progress.has(key)) return;
      const Kind = Schema.Struct({ kind: Schema.Literals(["begin", "report", "end"]) });
      const kind = Schema.decodeUnknownSync(Kind)(input.value).kind;

      const value = Schema.decodeUnknownSync(LanguageProgress.fields.value)({
        ...input.value,
        _tag: { begin: "Begin", report: "Report", end: "End" }[kind],
      });

      if (kind === "end") this.progress.delete(key);
      this.hooks.emit(
        LanguageContextEvent.cases.Progress.make({
          progress: { context: this.hooks.context, token: input.token, value },
        })
      );
    }
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.internal?.cleanup();
      pending.internal?.reject(failure("cancelled", "Receipt challenge closed"));
    }

    this.pending.clear();
    this.registrations.clear();
    this.progress.clear();
  }
}
