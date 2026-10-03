import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { captureEditIntentFence } from "./editFence.ts";
import type {
  LanguageAdapterOptions,
  LanguageBuffer,
  LanguageProvider,
  ProviderResult,
} from "./types.ts";

type Method = typeof P.LanguageFeatureMethod.Type;

type Params = typeof P.LanguageJsonObject.Type;

export const providerFence = (
  provider: LanguageProvider,
  buffer: LanguageBuffer
): P.LanguageRequestFence =>
  P.LanguageRequestFence.make({
    context: provider.context,
    requiredSequence: provider.ack.acceptedSequence,
    documents: [{ uri: buffer.uri, version: buffer.version }],
  });

export const sameFence = (left: P.LanguageRequestFence, right: P.LanguageRequestFence): boolean =>
  left.requiredSequence === right.requiredSequence &&
  P.languageFenceSatisfied(left, {
    context: right.context,
    acceptedSequence: right.requiredSequence,
    documents: right.documents,
  }) &&
  P.languageFenceSatisfied(right, {
    context: left.context,
    acceptedSequence: left.requiredSequence,
    documents: left.documents,
  });

export class LanguageRequests {
  private readonly lifetime = new AbortController();
  private readonly active = new Map<string, AbortController>();
  private pending = 0;
  private serial = 0;
  private readonly requestPrefix = `editor-${crypto.randomUUID()}`;
  private epoch = new AbortController();
  readonly timeoutMs: number;
  readonly maxPending: number;

  constructor(readonly options: LanguageAdapterOptions) {
    const timeoutMs = Schema.decodeUnknownSync(P.LanguageCounter)(options.timeoutMs ?? 5000);
    const maxPending = Schema.decodeUnknownSync(P.LanguageCounter)(options.maxPending ?? 32);
    this.timeoutMs = Math.min(30000, Math.max(1, timeoutMs));
    this.maxPending = Math.min(128, Math.max(1, maxPending));
  }

  invalidate() {
    this.epoch.abort();
    this.epoch = new AbortController();

    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }

  get signal(): AbortSignal {
    return AbortSignal.any([this.lifetime.signal, this.epoch.signal]);
  }

  reserve(): (() => void) | null {
    if (this.signal.aborted || this.pending >= this.maxPending) return null;
    this.pending++;

    return () => {
      this.pending--;
    };
  }

  dispose() {
    this.lifetime.abort();
    this.invalidate();
  }

  current(provider: LanguageProvider, buffer: LanguageBuffer): boolean {
    const current = this.options.buffer();

    const found = this.options
      .providers()
      .find(
        (entry) =>
          entry.context.contextId === provider.context.contextId &&
          entry.context.providerId === provider.context.providerId
      );

    return (
      !this.lifetime.signal.aborted &&
      current.uri === buffer.uri &&
      current.version === buffer.version &&
      current.lineSeparator === buffer.lineSeparator &&
      current.doc === buffer.doc &&
      found !== undefined &&
      P.languageFenceSatisfied(providerFence(found, buffer), found.ack) &&
      P.languageFenceSatisfied(providerFence(provider, buffer), found.ack)
    );
  }

  intentCurrent(
    provider: LanguageProvider,
    buffer: LanguageBuffer,
    fence: P.LanguageRequestFence
  ): boolean {
    const latest = this.options
      .providers()
      .find(
        (entry) =>
          entry.context.contextId === provider.context.contextId &&
          entry.context.providerId === provider.context.providerId
      );

    return (
      this.current(provider, buffer) &&
      latest !== undefined &&
      P.languageFenceSatisfied(fence, latest.ack)
    );
  }

  async query(
    method: Method,
    parameters: (provider: LanguageProvider) => Params,
    signal?: AbortSignal,
    lane: string = method,
    target?: LanguageProvider
  ): Promise<ProviderResult[]> {
    this.active.get(lane)?.abort();
    const controller = new AbortController();
    this.active.set(lane, controller);

    const joined = AbortSignal.any([
      controller.signal,
      this.lifetime.signal,
      ...(signal ? [signal] : []),
    ]);

    const buffer = this.options.buffer();

    const providers = this.options
      .providers()
      .slice(0, 32)
      .filter(
        (provider) =>
          provider.capabilities.methods.includes(method) &&
          this.current(provider, buffer) &&
          (target === undefined ||
            sameFence(providerFence(provider, buffer), providerFence(target, buffer)))
      );

    try {
      const results = await Promise.all(
        providers.map((provider) =>
          this.one(provider, buffer, method, parameters(provider), joined)
        )
      );

      if (joined.aborted) return [];

      return results.flatMap((result) => {
        if (!result || !this.intentCurrent(result.provider, buffer, result.request.fence))
          return [];

        const latest = this.options
          .providers()
          .find((entry) => entry.context.contextId === result.provider.context.contextId);

        return latest?.capabilities.methods.includes(method) ? [result] : [];
      });
    } finally {
      if (this.active.get(lane) === controller) this.active.delete(lane);
    }
  }

  private async one(
    provider: LanguageProvider,
    buffer: LanguageBuffer,
    method: Method,
    params: Params,
    signal: AbortSignal
  ): Promise<ProviderResult | null> {
    if (signal.aborted) return null;
    const requestId = `${this.requestPrefix}-${++this.serial}`;
    let fence: P.LanguageRequestFence;

    try {
      fence =
        method === "textDocument/rename" ||
        method === "textDocument/codeAction" ||
        method === "codeAction/resolve"
          ? captureEditIntentFence(provider, buffer)
          : providerFence(provider, buffer);
    } catch {
      return null;
    }

    const request = P.LanguageFeatureRequest.make({
      requestId,
      fence,
      method,
      params,
      deadline: Date.now() + this.timeoutMs,
    });

    const release = this.reserve();

    if (release === null) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};

    let dispatched = false;

    try {
      const cancelled = new Promise<null>((resolve) => {
        abort = () => {
          void this.options.api
            .request("languages.cancel", {
              hostKey: provider.hostKey,
              context: provider.context,
              requestId,
            })
            .catch(() => undefined);
          resolve(null);
        };

        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(abort, this.timeoutMs);
      });

      const remote = this.options.api
        .request("languages.request", { hostKey: provider.hostKey, ...request })
        .finally(release);

      dispatched = true;

      const answer = await Promise.race([remote, cancelled]);

      if (answer === null || !answer.ok || !this.current(provider, buffer) || signal.aborted)
        return null;
      const value = Schema.decodeUnknownSync(P.LanguageFeatureResult)(answer.value);

      const latest = this.options
        .providers()
        .find((entry) => entry.context.contextId === provider.context.contextId);

      if (
        !latest?.capabilities.methods.includes(method) ||
        !P.languageFenceSatisfied(fence, latest.ack)
      )
        return null;

      if (value.requestId !== requestId || !sameFence(fence, value.fence)) return null;

      return { provider, request, value };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);

      if (!dispatched) release();
    }
  }
}
