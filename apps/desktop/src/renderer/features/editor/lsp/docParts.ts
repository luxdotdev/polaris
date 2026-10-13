import { Predicate } from "effect";
import type { DocPart, SignaturePart } from "./docs.tsx";
import {
  fence,
  hoverPart,
  tidyDocs,
  type CompletionItem,
  type HoverPart,
  type Signature,
} from "./payloads.ts";

/** A row shows the server's detail only when it is short, such as a type (DESIGN.md, Editor). */
export const ROW_DETAIL_MAX = 24;

export const rowDetail = (item: CompletionItem): string | undefined => {
  const detail = (item.labelDetails?.description ?? item.detail)?.trim();

  return detail && detail.length <= ROW_DETAIL_MAX && !detail.includes("\n") ? detail : undefined;
};

/** The fence language for a buffer: its extension, which Shiki takes as an alias. */
export const fenceLanguage = (uri: string): string => /\.([A-Za-z0-9]+)$/.exec(uri)?.[1] ?? "";

/** Completion info: the item's detail as code, a hairline, then its docs. */
export const completionDocs = (item: CompletionItem, language: string): readonly HoverPart[] => {
  const detail = item.detail?.trim();
  const docs = item.documentation ? tidyDocs(hoverPart(item.documentation)) : undefined;
  const parts: HoverPart[] = [];

  // Docs that open with their own signature (basedpyright, Phpactor) need no detail above them.
  if (detail && !docs?.text.includes(detail) && !/^(`{3,}|~{3,})/.test(docs?.text ?? ""))
    parts.push({ kind: "markdown", text: fence(language, detail) });

  if (docs && docs.text !== "") {
    if (parts.length) parts.push({ kind: "markdown", text: "---" });
    parts.push(docs);
  }

  return parts;
};

type SignatureInformation = NonNullable<typeof Signature.Type>["signatures"][number];

const activeRange = (
  signature: SignatureInformation,
  index: number | undefined
): SignaturePart["active"] => {
  const parameter = index === undefined ? undefined : signature.parameters?.[index];

  if (!parameter) return undefined;

  if (!Predicate.isString(parameter.label)) return parameter.label;
  const from = signature.label.indexOf(parameter.label, Math.max(0, signature.label.indexOf("(")));

  return from === -1 ? undefined : [from, from + parameter.label.length];
};

/** Signature help: the active signature with its parameter marked, then that parameter's and its docs. */
export const signatureDocs = (payload: NonNullable<typeof Signature.Type>): readonly DocPart[] => {
  const signature = payload.signatures[payload.activeSignature ?? 0];

  if (!signature) return [];
  const index = signature.activeParameter ?? payload.activeParameter;
  const parameter = index === undefined ? undefined : signature.parameters?.[index];

  const docs = [parameter?.documentation, signature.documentation]
    .flatMap((markup) => (markup === undefined ? [] : [tidyDocs(hoverPart(markup))]))
    .filter((part) => part.text !== "");

  const active = activeRange(signature, index);

  const line: SignaturePart = active
    ? { kind: "signature", text: signature.label, active }
    : { kind: "signature", text: signature.label };

  return [line, ...docs];
};
