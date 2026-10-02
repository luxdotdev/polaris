import type { Capability } from "../capabilities.ts";

/** Require languages as well, except preview media which works without execution trust or tooling. */
export const LANGUAGE_RPC_CAPABILITIES = {
  "languages.catalog": "languages",
  "languages.availability": "languages",
  "languages.availability.watch": "languages",
  "languages.install": "languages.install",
  "languages.install.cancel": "languages.install",
  "languages.install.watch": "languages.install",
  "languages.discover": "languages",
  "languages.trust.get": "languages.trust",
  "languages.trust.set": "languages.trust",
  "languages.context.acquire": "languages",
  "languages.context.release": "languages",
  "languages.context.restart": "languages",
  "languages.context.watch": "languages",
  "languages.document.sync": "languages",
  "languages.request": "languages",
  "languages.cancel": "languages",
  "languages.progress.cancel": "languages",
  "languages.server.respond": "languages",
  "languages.context.configure": "languages",
  "languages.format": "languages.format",
  "languages.edit.decide": "languages.edits",
  "languages.operation.get": "languages.edits",
  "languages.operation.recover": "languages.edits",
  "languages.preview.media": "languages.preview-media",
} satisfies Readonly<Record<string, Capability>>;

/** Resource-bearing proposals also require languages.resources and a connected Host at acceptance. */
export const languageRpcAllowed = (
  method: keyof typeof LANGUAGE_RPC_CAPABILITIES,
  capabilities: ReadonlyArray<Capability>
): boolean =>
  capabilities.includes(LANGUAGE_RPC_CAPABILITIES[method]) &&
  (method === "languages.preview.media" || capabilities.includes("languages"));
