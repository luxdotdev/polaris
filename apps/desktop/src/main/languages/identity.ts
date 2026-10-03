import { decodeLanguage, languageFailure } from "@polaris/client";
import { LanguageClientIdentity } from "../../shared/languages.ts";
import type { LanguageHost } from "./index.ts";

/** Only Main's independently authenticated live transport can supply this identity. */
export const clientIdentityOf = (host: LanguageHost) => {
  const transport = host.access?.transport;

  if (transport === undefined || transport.signal.aborted || host.connectionEpoch === undefined)
    throw languageFailure("not-connected");

  if (transport.hostId !== host.hostId) throw languageFailure("not-owner");

  if (!transport.capabilities.includes("languages"))
    throw languageFailure("unsupported-capability");

  return decodeLanguage(LanguageClientIdentity, {
    hostId: transport.hostId,
    clientId: transport.clientId,
    connectionEpoch: host.connectionEpoch,
  });
};
