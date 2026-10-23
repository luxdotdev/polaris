/** Peer-controlled diagnostics must not inject log lines or expose Pairing credentials. */
export const gatewayLogText = (text: string, limit = 2048) =>
  text
    .replace(/polaris-pair:v1:[A-Za-z0-9_-]+/g, "[pairing redacted]")
    .replace(/pol_ext_[A-Za-z0-9_-]+/g, "[token redacted]")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .slice(0, limit);
