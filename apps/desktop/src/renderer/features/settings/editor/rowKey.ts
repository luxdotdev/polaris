/**
 * Which Settings → Editor → Languages row an integration lands in: integrations
 * sharing a server share a row, except the web and data ones, which keep their own.
 * Dependency-free so the language status smoke can count rows from the catalog.
 */

const OWN_ROW = new Set(["json", "css", "html", "actions"]);

export interface RowKeyInput {
  readonly id: string;
  readonly offered?: boolean | undefined;
  readonly providers: ReadonlyArray<{ readonly tool: string }>;
}

export const rowKeyOf = (integration: RowKeyInput) =>
  OWN_ROW.has(integration.id) ? integration.id : (integration.providers[0]?.tool ?? integration.id);

/** One row per key among the offered integrations. */
export const rowCount = (integrations: ReadonlyArray<RowKeyInput>) =>
  new Set(integrations.flatMap((i) => (i.offered === true ? [rowKeyOf(i)] : []))).size;
