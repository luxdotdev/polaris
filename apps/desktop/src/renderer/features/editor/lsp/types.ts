import type { Text } from "@codemirror/state";
import type * as P from "@polaris/protocol";
import type { LanguageApi } from "../../../../shared/api.ts";
import { LANGUAGES, type LanguageId } from "../model/language.ts";

export interface LanguageBuffer {
  readonly uri: string;
  readonly version: number;
  readonly doc: Text;
  readonly lineSeparator?: "\n" | "\r\n";
}

/** E1 supplies acquired, synchronized contexts in configured provider order. */
export interface LanguageProvider {
  readonly hostKey: string;
  readonly context: P.LanguageContextIdentity;
  readonly capabilities: P.LanguageProviderCapabilities;
  readonly ack: P.LanguageSyncAck;
  readonly completionTriggerCharacters?: readonly string[];
}

export interface LanguageAdapterOptions {
  readonly api: LanguageApi;
  readonly buffer: () => LanguageBuffer;
  readonly providers: () => readonly LanguageProvider[];
  readonly timeoutMs?: number;
  readonly maxPending?: number;
}

export interface ProviderResult {
  readonly provider: LanguageProvider;
  readonly value: P.LanguageFeatureResult;
}

export const documentLanguageId = (language: LanguageId): string =>
  LANGUAGES[language].documentLanguageId;

export const bufferText = (buffer: LanguageBuffer): string =>
  buffer.doc.sliceString(0, buffer.doc.length, buffer.lineSeparator ?? "\n");
