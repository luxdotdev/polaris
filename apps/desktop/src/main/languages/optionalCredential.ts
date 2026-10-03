import { loadLanguageCredential } from "./credential.ts";

/** Unsafe private records disable language identity without changing ordinary Client startup. */
export const optionalLanguageCredential = (directory: string, warn: (message: string) => void) => {
  try {
    return { clientIdentity: { proof: loadLanguageCredential(directory) } };
  } catch {
    warn("Language identity unavailable: private credential could not be loaded");

    return {};
  }
};
