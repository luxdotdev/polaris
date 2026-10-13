/**
 * `completionItem/resolve`, once per offered item, shared by the info panel and acceptance:
 * tsserver and basedpyright send docs, and tsserver its auto-import edits, only on resolve.
 */
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { CompletionProposal } from "./codemirror.ts";
import type { LanguageFeatures } from "./features.ts";
import {
  CompletionItem as CompletionItemSchema,
  decodePayload,
  type CompletionItem,
} from "./payloads.ts";

/** How long a typed trigger or an acceptance waits on the server before going without it. */
export const SETTLE_MS = 2_000;

/** The server's answer folded into the offered item; range and insert text stay as offered. */
const merged = (item: CompletionItem, value: CompletionItem): CompletionItem => {
  const full = { ...item };

  if (value.detail !== undefined) full.detail = value.detail;

  if (value.documentation !== undefined) full.documentation = value.documentation;

  if (value.additionalTextEdits !== undefined) full.additionalTextEdits = value.additionalTextEdits;

  if (value.command !== undefined) full.command = value.command;

  return CompletionItemSchema.make(full);
};

/** The resolved item, or `undefined` when the server has none or the request was superseded. */
const resolve = async (
  features: LanguageFeatures,
  { item, provider }: CompletionProposal
): Promise<CompletionItem | undefined> => {
  const json = Schema.decodeUnknownSync(P.LanguageJsonObject)(
    Schema.encodeSync(CompletionItemSchema)(item)
  );

  const [answer] = await features.resolve(provider, "completionItem/resolve", json);
  const value = answer ? decodePayload(CompletionItemSchema, answer.value.result) : undefined;

  return value ? merged(item, value) : undefined;
};

export interface CompletionResolver {
  /** The resolved item once it has arrived. */
  readonly settled: () => CompletionItem | undefined;
  /** The resolved item, or the offered one when the server has no answer. */
  readonly item: () => Promise<CompletionItem>;
  /** As `item`, but the offered item after `ms` without an answer. */
  readonly within: (ms: number) => Promise<CompletionItem>;
}

/** A superseded or failed resolve is asked again next time rather than remembered. */
export const completionResolver = (
  features: LanguageFeatures,
  proposal: CompletionProposal
): CompletionResolver => {
  let pending: Promise<CompletionItem> | undefined;
  let settled: CompletionItem | undefined;

  const item = () =>
    (pending ??= resolve(features, proposal)
      .catch(() => undefined)
      .then((value) => {
        if (value === undefined) pending = undefined;
        else settled = value;

        return value ?? proposal.item;
      }));

  const within = (ms: number) => {
    if (settled !== undefined) return Promise.resolve(settled);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<CompletionItem>((done) => {
      timer = setTimeout(() => done(proposal.item), ms);
    });

    return Promise.race([item(), timeout]).finally(() => clearTimeout(timer));
  };

  return { settled: () => settled, item, within };
};
