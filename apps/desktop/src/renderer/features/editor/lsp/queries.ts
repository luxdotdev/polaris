import * as P from "@polaris/protocol";
import type { EditorLanguageCoordinator } from "./integration.ts";
import type { LanguageProvider } from "./types.ts";
import { languagePatch, type LanguageRow } from "./state.ts";
import { offsetAt, positionAt } from "./position.ts";
import { fileKey } from "../model/drafts.ts";
import { openFile, type EditorFile } from "../api.ts";
import { viewOf, whenLoaded, revealLine } from "../runtime/buffers.ts";
import * as Payload from "./payloads.ts";

export type LanguageCommand =
  | "definition"
  | "typeDefinition"
  | "implementation"
  | "references"
  | "symbols"
  | "workspaceSymbols"
  | "signature"
  | "problems"
  | "actions"
  | "rename";

export const locationPath = (uri: string, root: string): string | null => {
  try {
    const url = new URL(uri);

    if (url.protocol !== "file:" || url.hostname !== "") return null;
    const path = decodeURIComponent(url.pathname);

    return path.startsWith(`${root.replace(/\/+$/, "")}/`) && !path.split("/").includes("..")
      ? path
      : null;
  } catch {
    return null;
  }
};

type Location = typeof Payload.Location.Type | typeof Payload.LocationLink.Type;

const rowOf = (location: Location, provider: LanguageProvider, label?: string): LanguageRow => {
  const uri = "targetUri" in location ? location.targetUri : location.uri;
  const range = "targetUri" in location ? location.targetSelectionRange : location.range;

  return {
    label: label ?? `${decodeURI(uri.split("/").pop() ?? uri)}:${range.start.line + 1}`,
    detail: provider.context.providerId,
    uri,
    range,
    encoding: provider.capabilities.positionEncoding,
  };
};

export class LanguageQueries {
  private readonly pending = new Map<string, AbortController>();
  private readonly history: Array<EditorFile & { readonly line: number; readonly column: number }> =
    [];
  private readonly previousIds = new Map<string, string>();

  constructor(readonly coordinator: EditorLanguageCoordinator) {}

  close(key: string) {
    this.pending.get(key)?.abort();
    this.pending.delete(key);
    languagePatch(key, { panel: null, rows: [], busy: false });
  }

  async run(key: string, command: LanguageCommand, query = "") {
    const entry = this.coordinator.get(key);

    if (entry === undefined) return;
    this.pending.get(key)?.abort();
    const controller = new AbortController();
    this.pending.set(key, controller);
    const buffer = entry.read();
    const ownership = entry.providerSignature;

    const panel = {
      definition: "Definitions",
      typeDefinition: "Type definitions",
      implementation: "Implementations",
      references: "References",
      symbols: "Document symbols",
      workspaceSymbols: "Workspace symbols",
      signature: "Signature help",
      problems: "Problems",
      actions: "Code actions",
      rename: "Rename",
    }[command];

    languagePatch(key, { panel, rows: [], busy: true });

    const current = () =>
      !controller.signal.aborted &&
      this.pending.get(key) === controller &&
      this.coordinator.get(key) === entry &&
      entry.providerSignature === ownership &&
      entry.read().doc === buffer.doc &&
      entry.read().version === buffer.version;

    try {
      let rows = await this.rowsFor(key, command, query, controller.signal);

      if (!current()) return;
      const seen = new Set<string>();
      rows = rows
        .filter((row) => {
          const signature = JSON.stringify([row.label, row.uri, row.range, row.detail]);

          if (seen.has(signature)) return false;
          seen.add(signature);

          return true;
        })
        .slice(0, 2000);
      languagePatch(key, { rows, busy: false });

      if (
        (command === "definition" ||
          command === "typeDefinition" ||
          command === "implementation") &&
        rows.length === 1 &&
        rows[0]
      )
        await this.navigate(key, rows[0]);
    } catch {
      if (current())
        languagePatch(key, {
          rows: [
            {
              label: "Language request failed.",
              detail: "The document or Host may have changed. Try again.",
            },
          ],
          busy: false,
        });
    }
  }

  private async rowsFor(
    key: string,
    command: LanguageCommand,
    query: string,
    signal: AbortSignal
  ): Promise<LanguageRow[]> {
    const entry = this.coordinator.get(key);

    if (entry === undefined) return [];
    const head = entry.input.view.state.selection.main.head;
    let rows: LanguageRow[] = [];
    const features = entry.features;

    if (
      command === "definition" ||
      command === "typeDefinition" ||
      command === "implementation" ||
      command === "references"
    ) {
      const answers =
        command === "references"
          ? await features.references(head, true, signal)
          : await features.navigation(`textDocument/${command}`, head, signal);

      rows = answers.flatMap(({ provider, payload }) =>
        ("uri" in payload ? [payload] : payload).map((location) => rowOf(location, provider))
      );
    } else if (command === "symbols") {
      rows = await this.symbolRows(entry, signal);
    } else if (command === "workspaceSymbols") {
      const answers = await features.workspaceSymbols(query, signal);
      rows = answers.flatMap(({ provider, payload }) =>
        payload.map((symbol): LanguageRow => ({
          label: symbol.name,
          detail: provider.context.providerId,
          uri: symbol.location.uri,
          ...(symbol.location.range
            ? { range: symbol.location.range, encoding: provider.capabilities.positionEncoding }
            : { run: () => void this.resolveSymbol(key, provider, symbol) }),
        }))
      );
    } else if (command === "signature") {
      const answers = await features.signature(head, signal);
      rows = answers.flatMap(({ provider, payload }) =>
        payload.signatures.map((signature) => ({
          label: signature.label,
          detail: `${provider.context.providerId} · Parameter ${(signature.activeParameter ?? payload.activeParameter ?? 0) + 1}`,
        }))
      );
    } else if (command === "problems") {
      await this.pullProblems(key, signal);
      rows = entry.diagnostics.values().flatMap(({ provider, diagnostics }) =>
        diagnostics.items.map((item) => ({
          label: item.message,
          detail: `${provider.context.providerId} · ${diagnostics.freshness}${diagnostics.truncated ? " · truncated" : ""}`,
          uri: diagnostics.uri,
          range: item.range,
          encoding: provider.capabilities.positionEncoding,
        }))
      );
    } else if (command === "rename") {
      if (query.trim() === "")
        return [{ label: "Enter a new name.", detail: "No edits were requested." }];
      const answers = await features.rename(head, query, signal);
      rows = answers.flatMap(({ provider, request, value }) => {
        const edit = Payload.decodePayload(P.LanguageWorkspaceEdit, value.result);

        return edit === undefined || edit === null
          ? []
          : [
              {
                label: `Rename to ${query}`,
                detail: `${provider.context.providerId} · Requires edit acceptance`,
                run: () =>
                  void this.coordinator.prepareEdit(
                    key,
                    provider,
                    request,
                    value,
                    edit,
                    "rename",
                    `Rename to ${query}`
                  ),
              },
            ];
      });
    } else {
      const selection = entry.input.view.state.selection.main;
      const answers = await features.codeActions(selection.from, selection.to, signal);
      rows = answers.flatMap(({ provider, request, value, payload }) =>
        payload.map((action) => ({
          label: action.title,
          detail:
            action.disabled?.reason ?? `${provider.context.providerId} · Requires edit acceptance`,
          run: () => void this.coordinator.action(key, provider, action, request, value),
        }))
      );
    }

    return rows;
  }

  private async symbolRows(
    entry: NonNullable<ReturnType<EditorLanguageCoordinator["get"]>>,
    signal: AbortSignal
  ): Promise<LanguageRow[]> {
    const features = entry.features;
    const buffer = entry.read();
    const rows: LanguageRow[] = [];
    const answers = await features.documentSymbols(signal);

    for (const answer of answers) {
      const stack = [...answer.payload].reverse();

      while (stack.length && rows.length < 2000) {
        const symbol = stack.pop();

        if (symbol === undefined) continue;

        if ("location" in symbol) rows.push(rowOf(symbol.location, answer.provider, symbol.name));
        else {
          rows.push(
            rowOf({ uri: buffer.uri, range: symbol.selectionRange }, answer.provider, symbol.name)
          );
          stack.push(...[...(symbol.children ?? [])].reverse());
        }
      }
    }

    return rows;
  }

  private async resolveSymbol(
    key: string,
    provider: LanguageProvider,
    symbol: NonNullable<typeof Payload.WorkspaceSymbols.Type>[number]
  ) {
    const entry = this.coordinator.get(key);

    if (entry === undefined) return;
    const answers = await entry.features.resolve(provider, "workspaceSymbol/resolve", symbol);

    const resolved =
      answers[0] && Payload.decodePayload(Payload.SymbolInformation, answers[0].value.result);

    if (resolved) await this.navigate(key, rowOf(resolved.location, provider, resolved.name));
  }

  private async pullProblems(key: string, signal: AbortSignal) {
    const entry = this.coordinator.get(key);

    if (entry === undefined) return;
    const buffer = entry.read();
    const answers = await entry.features.pullDiagnostics(this.previousIds, signal);

    for (const { provider, payload } of answers) {
      const previousResultId = this.previousIds.get(provider.context.contextId) ?? null;
      const resultId = payload.resultId ?? null;

      if (resultId !== null) this.previousIds.set(provider.context.contextId, resultId);
      entry.diagnostics.receive(
        provider,
        P.LanguageDiagnostics.make({
          context: provider.context,
          uri: buffer.uri,
          providerId: provider.context.providerId,
          generation: provider.context.generation,
          version: buffer.version,
          freshness: "versioned",
          kind: payload.kind,
          resultId,
          previousResultId,
          items:
            payload.kind === "full"
              ? payload.items.map((item) => ({
                  ...item,
                  severity: item.severity ?? null,
                  code: item.code ?? null,
                  source: item.source ?? null,
                  tags: item.tags ?? [],
                }))
              : [],
          truncated: false,
        })
      );
    }
  }

  async navigate(key: string, row: LanguageRow) {
    if (row.run) {
      row.run();

      return;
    }

    const entry = this.coordinator.get(key);

    if (
      entry === undefined ||
      row.uri === undefined ||
      row.range === undefined ||
      row.encoding === undefined
    )
      return;
    const provider = entry.features.options.providers()[0];

    if (provider === undefined) return;
    const path = locationPath(row.uri, provider.context.checkout.path);

    if (path === null) {
      languagePatch(key, {
        rows: [
          {
            label: "This target is outside the current checkout.",
            detail: "Open it explicitly in its Workspace.",
          },
        ],
      });

      return;
    }

    const ownership = entry.providerSignature;
    const sourceVersion = entry.read().version;
    const origin = entry.input.view.state.selection.main.head;
    const point = positionAt(entry.input.view.state.doc, origin, "utf-16");
    this.history.push({ ...entry.input.file, line: point.line + 1, column: point.character + 1 });

    if (this.history.length > 100) this.history.shift();
    const file = { ...entry.input.file, path };
    openFile(file);
    await whenLoaded(fileKey(file.hostKey, path));
    const view = viewOf(fileKey(file.hostKey, path));

    if (
      view === null ||
      this.coordinator.get(key) !== entry ||
      entry.providerSignature !== ownership ||
      entry.read().version !== sourceVersion
    )
      return;

    try {
      const offset = offsetAt(view.state.doc, row.range.start, row.encoding);
      const line = view.state.doc.lineAt(offset);
      revealLine(view, line.number, offset - line.from + 1);
    } catch {
      languagePatch(key, {
        rows: [
          { label: "The target position is no longer valid.", detail: "Request navigation again." },
        ],
      });
    }
  }

  back() {
    const previous = this.history.pop();

    if (previous) openFile(previous);
  }
}
