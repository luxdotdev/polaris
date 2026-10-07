import { LanguageError } from "@polaris/protocol";
import { Option, Schema } from "effect";
import type { IpcError } from "./api.ts";

export const languageIpcError = (error: IpcError): LanguageError => {
  const decoded = Schema.decodeUnknownOption(LanguageError)(error.languageError);

  if (Option.isSome(decoded)) return decoded.value;

  return new LanguageError({ reason: "not-ready", message: error.message, retryable: true });
};
