/** Diagnostics are bounded text, never a second copy of a Pairing credential. */
export const diagnosticText = (text: string) =>
  text
    .replace(/polaris-pair:v1:[A-Za-z0-9_-]+/g, "[pairing redacted]")
    .replace(/pol_ext_[A-Za-z0-9_-]+/g, "[token redacted]")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .slice(0, 1000);
